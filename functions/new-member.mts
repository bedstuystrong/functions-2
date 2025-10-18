import path from 'node:path';
import { Context } from '@netlify/functions';
import { ManagementClient } from 'auth0';
import { WebClient } from '@slack/web-api';
import postmark from 'postmark';
import { Eta } from 'eta';
import juice from 'juice';

import AirtableBase from '../lib/airtable.mjs';

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

  const member = membersTable.normalize(await membersTable._table.find(airtableMemberId));
  if (!member) {
    return;
  }

  try {
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

      const postmarkClient = new postmark.ServerClient(Netlify.env.get('POSTMARK_SERVER_API_TOKEN')!);
      await postmarkClient.sendEmail({
        From: '"Bed-Stuy Strong" <community@bedstuystrong.com>',
        To: member.email,
        Subject: subject,
        HtmlBody: juice(renderedEmail, { removeStyleTags: false }),
        MessageStream: 'outbound'
      });
    } catch (error) {
      console.log('email error', error, { airtableMemberId });
      throw error;
    }
    // set as processed? or do in airtable?

    return Response.json({
      cool: true,
    });

  } catch (error) {

    console.error(error);
    return new Response(JSON.stringify({
      cool: false,
      error: {
        name: error?.name,
        message: error?.message,
      }
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });

  }
}