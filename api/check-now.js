// api/check-now.js
// Lets a signed-in user check ONE of their own monitors immediately,
// instead of waiting for the once-a-day cron. Unlike cron-check.js, this
// runs as the user themselves (via their auth token), not with elevated
// service-role access — Row Level Security naturally makes sure someone
// can only ever check-now their own monitor, never anyone else's, just by
// using the same auth pattern as monitors.js.
//
// Sends the same down/recovered emails as the daily cron, using the same
// transition logic, so a manual check behaves consistently with an
// automatic one — this doubles as the easiest way to test the alert
// emails without waiting for the scheduled run.

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
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing monitor id.' });

  const authHeader = req.headers.authorization || '';
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return res.status(401).json({ error: 'Not signed in.' });
  }

  // RLS means this will simply return nothing if the id isn't this user's.
  const { data: monitor, error: fetchError } = await supabase
    .from('monitors')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError || !monitor) {
    return res.status(404).json({ error: 'Monitor not found.' });
  }

  const { isUp, statusCode } = await checkUrl(monitor.url);
  const justWentDown = monitor.is_up && !isUp;
  const justRecovered = monitor.last_checked_at && !monitor.is_up && isUp;

  const { data: updated, error: updateError } = await supabase
    .from('monitors')
    .update({
      is_up: isUp,
      last_status_code: statusCode,
      last_checked_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .single();

  if (updateError) return res.status(500).json({ error: updateError.message });

  let emailed = false;
  if ((justWentDown || justRecovered) && user.email) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    if (justWentDown) {
      await resend.emails.send({
        from: process.env.ALERT_FROM_EMAIL,
        to: user.email,
        subject: `PulseCheck: ${monitor.name} appears to be down`,
        text: `${monitor.name} (${monitor.url}) did not respond successfully during a manual check.\n\nStatus code: ${statusCode ?? 'no response'}`
      });
    } else {
      await resend.emails.send({
        from: process.env.ALERT_FROM_EMAIL,
        to: user.email,
        subject: `PulseCheck: ${monitor.name} is back up`,
        text: `Good news — ${monitor.name} (${monitor.url}) responded successfully during a manual check, after previously being down.\n\nStatus code: ${statusCode}`
      });
    }
    emailed = true;
  }

  return res.status(200).json({ monitor: updated, emailed });
}
