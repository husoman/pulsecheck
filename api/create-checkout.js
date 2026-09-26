// api/create-checkout.js
// Called when a signed-in user clicks "Upgrade to Pro". Creates a Stripe
// Checkout session and returns the URL to redirect them to. We pass the
// Supabase user id in `client_reference_id` so the webhook (stripe-webhook.js)
// knows which user to upgrade once payment succeeds.

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed.' });
  }

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

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      client_reference_id: user.id,
      customer_email: user.email,
      success_url: `${process.env.PUBLIC_SITE_URL}/?upgraded=1`,
      cancel_url: `${process.env.PUBLIC_SITE_URL}/`
    });
    return res.status(200).json({ url: session.url });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
