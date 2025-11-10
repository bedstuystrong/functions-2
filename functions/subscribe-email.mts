import { Context } from '@netlify/functions';

import AirtableBase from '../lib/airtable.mjs';
import { verify } from 'hcaptcha';

const HCAPTCHA_SECRET_KEY = Netlify.env.get("HCAPTCHA_SECRET_KEY");
if (!HCAPTCHA_SECRET_KEY) throw new Error("Missing HCAPTCHA_SECRET_KEY")

const headers = {
  "Access-Control-Allow-Origin": Netlify.env.get("BSS_WEBSITE_ORIGIN") ?? "https://www.bedstuystrong.com",
};

export default async (request: Request, context: Context) => {
  switch (request.method) {
    case "OPTIONS":
      return new Response("ok", {headers});
    case "POST": {
      const form = await request.formData();

      const email = form.get("email");

      const token = form.get("h-captcha-response")?.toString();
      if (!token) return new Response("Missing captcha", {status: 400, headers});

      const {success} = await verify(HCAPTCHA_SECRET_KEY, token);
      if (!success) return new Response("Invalid captcha", {status: 400, headers});

      try {
        const contacts = new AirtableBase('emails').table('contacts');
        // @ts-ignore-error FIXME
        contacts._table.update([{
          fields: contacts.denormalize({
            email,
            source: "website"
          })
        }], {
          performUpsert: {
            fieldsToMergeOn: ['email']
          }
        });
      } catch (error) {
        return new Response("Failed to subscribe", {status: 500, headers});
      }

      return Response.json({
        success: true,
        email
      }, {
        headers
      });
    };
    default:
      return new Response("Method not supported", {status: 400, headers});
  }

};