import { Context } from '@netlify/functions';
import { simpleParser } from 'mailparser';
import { type AddressObject, EmailAddress } from 'mailparser';
import sendgridMail from '@sendgrid/mail';
import _ from 'lodash';
import fp from 'lodash/fp.js';

import AirtableBase from '../lib/airtable.mjs';
import parseMultipartForm from '../lib/multipart.mjs';

sendgridMail.setApiKey(Netlify.env.get('SENDGRID_API_KEY'));

const FUND_EMAIL_ADDRESS = 'fund@bedstuystrong.com';

interface Email {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
}

interface FinanceTransaction {
  date: string; // ?
  direction: 'In' | 'Out';
  platform: 'Venmo' | 'Zelle' | 'Paypal' | 'Google Pay' | 'Cash App';
  amount: number;
  name: string;
  note?: string;
}

const FINANCE_TRANSACTION_DIRECTIONS = {
  In: 'recHqZivpo6j4T6On',
  Out: 'reckW3l4mK8BCEBsd',
};

const createFinanceTransaction = async ({ direction, platform, amount, name, note, date }: FinanceTransaction) => {
  const transactions = new AirtableBase('finance').table('transactions');

  const directionID = FINANCE_TRANSACTION_DIRECTIONS[direction];

  return await transactions.create({
    direction: [directionID],
    platform: platform,
    amount: amount,
    name: name,
    notes: note,
    date: date,
  });
}

const PLATFORMS = {
  venmo: {
    from: 'venmo@venmo.com',
    regex: /From: Venmo <venmo@venmo\.com>/,
  },
  zelle: {
    from: '',
    regex: /USAA Confirmation ID: [\d\n\r]+Zelle ID:/m,
  },
  amalgamated_zelle: {
    from: 'noreply@online.amalgamatedbank.com',
    regex: /From: Amalgamated Bank <noreply@online\.amalgamatedbank\.com>/,
  },
  paypal: {
    from: 'service@paypal.com',
    regex: /From: service@paypal\.com <service@paypal\.com>/,
  },
  googlepay: {
    from: 'googlepay-noreply@google.com',
    regex: /From: Google Pay <googlepay-noreply@google\.com>/,
  },
  cashapp: {
    from: 'cash@square.com',
    regex: /From: Cash App <cash@square\.com>/
  },
};

const getFirstEmailAddressFromHeader = (header: AddressObject) => fp.flow(
  fp.get('value'),
  fp.map((v: EmailAddress) => v.address),
  fp.head,
)(header);

const detectPaymentPlatform = (email: Email, { isAutoForwarded }: { isAutoForwarded: boolean }) => {
  if (isAutoForwarded) {
    return _.findKey(PLATFORMS, (platform) => {
      if (platform.from) {
        return platform.from === email.from;
      } else {
        return platform.regex.test(email.text);
      }
    });
  } else {
    return _.findKey(PLATFORMS, platform => platform.regex.test(email.text));
  }
};

interface TransactionDetails extends Omit<FinanceTransaction, 'amount' | 'date'> {
  amount: string;
}

const extractPaymentDetails = (platform: string, email: Email) => {
  const details = {} as TransactionDetails;

  switch (platform) {
    case 'venmo': {
      details.platform = 'Venmo';
      const fromMatches = email.subject.match(/(?:Fwd:\s)?(.+) paid you (\$[\d.,]+)/);
      const toMatches = email.subject.match(/You paid (.+) (\$[\d.,]+)/);
      const noteMatches = email.html.match(/<!-- note -->\s*<div>\s*<p>(.*)<\/p>/m);

      if (fromMatches) {
        details.direction = 'In';
        details.name = fromMatches[1];
        details.amount = fromMatches[2];
      } else if (toMatches) {
        details.direction = 'Out';
        details.name = toMatches[1];
        details.amount = '-' + toMatches[2];
      }

      if (noteMatches) {
        details.note = noteMatches[1];
      } else {
        console.log('venmo html', email.html)
        throw new Error('Missing Venmo note');
      }

      break;
    }
    case 'zelle': {
      details.platform = 'Zelle';
      const fromMatches = email.text.match(/tell you that (.*) sent ([$\d.,]+) with/);
      const toMatches = email.text.match(/that you sent (\$[\d.,]+) to (.*) on/);

      if (fromMatches) {
        details.direction = 'In';
        details.name = fromMatches[1];
        details.amount = fromMatches[2];
      } else if (toMatches) {
        details.direction = 'Out';
        details.name = toMatches[2];
        details.amount = '-' + toMatches[1];
      }
      break;
    }
    case 'amalgamated_zelle': {
      details.platform = 'Zelle';
      const fromMatches = email.subject.match(/Notification - (.*) sent you (\$[\d.,]+)/);
      const toMatches = email.subject.match(/Notification - Your \s?(\$[\d.,]+) to (.*) was sent/);
      const noteMatches = email.html.match(/<p class="memo" [^>]+>(.*)<\/p>/m);

      if (fromMatches) {
        details.direction = 'In';
        details.name = fromMatches[1];
        details.amount = fromMatches[2];
      } else if (toMatches) {
        details.direction = 'Out';
        details.name = toMatches[2];
        details.amount = '-' + toMatches[1];
      }

      if (noteMatches) {
        details.note = noteMatches[1];
      }

      break;
    }
    case 'paypal': {
      details.platform = 'Paypal';
      const text = email.html.replace(/(<([^>]+)>)/ig, '');
      const fromMatches = text.match(/(.*) sent you ([$\d.,]+)/);
      const toMatches = text.match(/You sent ([$\d.,]+) USD to (.*)/);
      const noteMatches = text.match(/\[image: quote\] (.*) \[image: quote\]/);

      if (fromMatches) {
        details.direction = 'In';
        details.name = fromMatches[1];
        details.amount = fromMatches[2];
      } else if (toMatches) {
        details.direction = 'Out';
        details.name = toMatches[2];
        details.amount = '-' + toMatches[1];
      }

      if (noteMatches) {
        details.note = noteMatches[1];
      }

      break;
    }
    case 'googlepay': {
      details.platform = 'Google Pay';
      const fromMatches = email.subject.match(/(.*) sent you ([$\d.,]+)/);
      const toMatches = email.subject.match(/You sent ([^$]+) ([$\d.,]+)/);

      if (fromMatches) {
        details.direction = 'In';
        details.name = fromMatches[1];
        details.amount = fromMatches[2];
      } else if (toMatches) {
        details.direction = 'Out';
        details.name = toMatches[1];
        details.amount = '-' + toMatches[2];
      }

      break;
    }
    case 'cashapp': {
      details.platform = 'Cash App';
      const fromMatches = email.subject.match(/(?:Fwd:\s)?(.+) sent you (\$[\d.,]+)(?: for (.*))?/);
      const toMatches = email.subject.match(/You sent (\$[\d.,]+) to (.*)/);
      const toAcceptedMatches = email.subject.match(/(?:Fwd: )?(.*) just accepted the (\$[\d.,]+) you sent(?: for (.*))/);

      if (fromMatches) {
        details.direction = 'In';
        details.name = fromMatches[1];
        details.amount = fromMatches[2];
        details.note = fromMatches[3];
      } else if (toMatches) {
        details.direction = 'Out';
        details.amount = '-' + toMatches[1];

        const split = toMatches[2].split(/ for (.+)/);
        if (split.length > 1) {
          details.name = split[0];
          details.note = split[1];
        } else {
          details.name = split[0];
        }
      } else if (toAcceptedMatches) {
        details.direction = 'Out';
        details.name = toAcceptedMatches[1];
        details.amount = '-' + toAcceptedMatches[2];
        details.note = toAcceptedMatches[3];
      }

      break;
    }
    default:
      throw new Error(`Unhandled payment platform: ${platform}`);
  }

  return details;
};

export default async (request: Request, context: Context) => {
  const formData = await parseMultipartForm(request) as Record<string, any>;
  if (!formData.email) {
    console.warn('Request missing email', formData);
    return new Response('OK', {
      status: 200,
    });
  }

  const parsed = await simpleParser(formData.email);
  const email = {
    ..._.pick(formData, ['to', 'from', 'subject']),
    ..._.pick(parsed, ['html', 'text']),
  } as Email;

  const date = parsed.headers.get('date');
  email.to = getFirstEmailAddressFromHeader(parsed.headers.get('to') as AddressObject);

  if (email.to.split('@')[0] !== 'funds' && email.to !== FUND_EMAIL_ADDRESS) {
    // Log and do nothing
    console.warn('Received email for user other than funds@', parsed);
    return new Response('OK', {
      status: 200,
    });
  }

  const isAutoForwarded = email.to === FUND_EMAIL_ADDRESS;

  email.from = getFirstEmailAddressFromHeader(parsed.headers.get('from') as AddressObject);

  if (!isAutoForwarded && email.from !== FUND_EMAIL_ADDRESS) {
    // Log and do nothing
    console.warn('Received email from unauthorized forwarder', parsed);
    return new Response('OK', {
      status: 200,
    });
  }

  const paymentPlatform = detectPaymentPlatform(email, { isAutoForwarded });
  if (!paymentPlatform) {
    // todo error
    console.error(parsed);
    await sendgridMail.send({
      from: 'finance-script@em9481.mail.bedstuystrong.com',
      to: FUND_EMAIL_ADDRESS,
      subject: 'Error parsing payment email',
      text: `Timestamp: ${(new Date()).toString()}`
    });
    throw new Error('Couldn\'t detect payment platform');
  }

  const details = extractPaymentDetails(paymentPlatform, email);

  console.log({ ...details, date })
  // @ts-ignore FIXME
  await createFinanceTransaction(Object.assign(details, { date }));

  return new Response('OK', {
    status: 200,
  });
}