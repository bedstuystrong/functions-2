import path from 'node:path';
import { Context } from '@netlify/functions';
import { ManagementClient } from 'auth0';
import { WebClient } from '@slack/web-api';
import sendgridMail from '@sendgrid/mail';
import { Eta } from 'eta';
import juice from 'juice';

import AirtableBase from '../lib/airtable.mjs';

sendgridMail.setApiKey(Netlify.env.get('SENDGRID_API_KEY')!);

export default async (request: Request, context: Context) => {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  const airtableMemberId = url.searchParams.get('memberId');

  if (!token || token !== Netlify.env.get('AIRTABLE_AUTOMATION_AUTH_TOKEN')) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (!airtableMemberId) {
    return;
  }

  const base = new AirtableBase('tickets');
  const membersTable = base.table('members');

  // const meta = await base.meta();
  // const statusField = meta.tables.find(table => table.name === membersTable.config.name)?.fields?.find(field => field.name === membersTable.config.schema.status);

  const member = membersTable.normalize(await membersTable._table.find(airtableMemberId));
  if (!member) {
    return;
  }

  // look up slack membership 
  const slackClient = new WebClient(Netlify.env.get('SLACK_API_TOKEN'));
  try {
    const { user: slackUser } = await slackClient.users.lookupByEmail({
      email: member.email,
    });

    // update member with slack id
    await membersTable._table.update(airtableMemberId, membersTable.denormalize({
      slackUserId: slackUser!.id,
    }));
  } catch (error) {
    if (error?.data?.error === 'users_not_found') {
      return new Response('Slack user does not exist', {
        status: 400,
      });
    } else {
      console.log('slack error', error, { airtableMemberId });
      throw error;
    }
  }

  // create auth0 user
  try {
    const management = new ManagementClient({
      domain: Netlify.env.get('AUTH0_DOMAIN')!,
      clientId: Netlify.env.get('AUTH0_CLIENT_ID')!,
      clientSecret: Netlify.env.get('AUTH0_CLIENT_SECRET')!,
    });

    await management.users.create({
      connection: 'email',
      email: member.email,
      name: member.name,
      email_verified: true,
    });
  } catch (error) {
    console.log('auth0 error', error, { airtableMemberId });
    throw error;
  }

  // Send the new member email
  try {
    const eta = new Eta({ views: path.resolve(process.cwd(), 'templates') });
    const subject = 'Welcome to Bed-Stuy Strong!';
    const renderedEmail = await eta.renderAsync('new-member-email', {
      name: member.name,
      subject,
    });
    await sendgridMail.send({
      from: {
        name: 'Bed-Stuy Strong',
        email: 'community@mail.bedstuystrong.com',
      },
      to: member.email,
      replyTo: 'community@bedstuystrong.com',
      subject: subject,
      html: juice(renderedEmail, { removeStyleTags: false }),
    });
  } catch (error) {
    console.log('email error', error, { airtableMemberId });
    throw error;
  }
  // set as processed? or do in airtable?

  return Response.json({
    cool: true,
  });

}