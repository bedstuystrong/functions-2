// @ts-nocheck
import Busboy from 'busboy';
import type { HandlerEvent } from '@netlify/functions';

// https://www.netlify.com/blog/2021/07/29/how-to-process-multipart-form-data-with-a-netlify-function/
export default function parseMultipartForm(event: HandlerEvent) {
  return new Promise((resolve, reject) => {
    // we'll store all form fields inside of this
    const fields: any = {};

    // let's instantiate our busboy instance!
    const busboy = Busboy({
      // it uses request headers
      // to extract the form boundary value (the ----WebKitFormBoundary thing)
      headers: event.headers
    });

    // whenever busboy comes across a normal field ...
    busboy.on('field', (fieldName, value) => {
      // ... we write its value into `fields`.
      fields[fieldName] = value;
    });

    busboy.on('close', () => {
      resolve(fields);
    });

    // once busboy is finished, we resolve the promise with the resulted fields.
    busboy.on('finish', () => {
      resolve(fields);
    });

    busboy.on('error', (error) => {
      console.log('busboy error');
      console.error(error);
      reject(error);
    });

    // now that all handlers are set up, we can finally start processing our request!
    const decodedBody = Buffer.from(event.body, 'base64').toString('ascii');
    busboy.end(decodedBody);
  });
}
