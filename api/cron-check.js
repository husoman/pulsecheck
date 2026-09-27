// api/cron-check.js
// Called once a day by Vercel Cron (see vercel.json). Pings every monitor
// in the database, updates its status, and emails the owner if a site that
// was previously up just went down.
//
// This uses the SERVICE ROLE key, not the anon key — it needs to see every
// user's monitors, not just one, so it deliberately bypasses Row Level
// Security. That's exactly why the CRON_SECRET check below matters: this
// endpoint has elevated access and must never be callable by the public.

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const CHECK_TIMEOUT_MS = 10000;

async function checkUrl(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: 'GET', signal: controller.signal });
    return { isUp: response.ok, statusCode: response.status };
  } catch {
    return { isUp: false, statusCode: null };
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req, res) {
  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  const resend = new Resend(process.env.RESEND_API_KEY);

  const { data: monitors, error } = await supabase.from('monitors').select('*');
  if (error) return res.status(500).json({ error: error.message });

  const results = [];

  for (const monitor of monitors) {
    const { isUp, statusCode } = await checkUrl(monitor.url);
    const justWentDown = monitor.is_up && !isUp;
    // Only counts as a "recovery" if it had actually been checked and found
    // down before — otherwise every brand-new monitor's very first successful
    // check would look like a "recovery" from the default is_up: true state.
    const justRecovered = monitor.last_checked_at && !monitor.is_up && isUp;

    await supabase
      .from('monitors')
      .update({
        is_up: isUp,
        last_status_code: statusCode,
        last_checked_at: new Date().toISOString()
      })
      .eq('id', monitor.id);

    if (justWentDown || justRecovered) {
      const { data: authUser } = await supabase.auth.admin.getUserById(monitor.user_id);
      const email = authUser?.user?.email;
      if (email) {
        if (justWentDown) {
          await resend.emails.send({
            from: process.env.ALERT_FROM_EMAIL,
            to: email,
            subject: `PulseCheck: ${monitor.name} appears to be down`,
            text: `${monitor.name} (${monitor.url}) did not respond successfully during today's check.\n\nStatus code: ${statusCode ?? 'no response'}\n\nWe'll keep checking it daily. You'll only get another email like this one if it comes back up and then goes down again — not for every day it stays down. Check your dashboard anytime for its current status.`
          });
        } else {
          await resend.emails.send({
            from: process.env.ALERT_FROM_EMAIL,
            to: email,
            subject: `PulseCheck: ${monitor.name} is back up`,
            text: `Good news — ${monitor.name} (${monitor.url}) responded successfully during today's check, after previously being down.\n\nStatus code: ${statusCode}`
          });
        }
      }
    }

    results.push({ name: monitor.name, isUp, statusCode });
  }

  return res.status(200).json({ checked: results.length, results });
}
