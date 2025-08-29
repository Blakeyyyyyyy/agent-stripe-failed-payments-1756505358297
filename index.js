const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');
const Airtable = require('airtable');

const app = express();
app.use(express.raw({ type: 'application/json' }));
app.use(express.json());

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base('appUNIsu8KgvOlmi0');

const transporter = nodemailer.createTransporter({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

let logs = [];

function addLog(msg) {
  const entry = { time: new Date().toISOString(), message: msg };
  logs.push(entry);
  if (logs.length > 50) logs = logs.slice(-50);
  console.log(entry.time + ': ' + msg);
}

async function sendEmail(data) {
  try {
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: process.env.ALERT_EMAIL || process.env.GMAIL_USER,
      subject: 'Payment Failed Alert',
      html: `<h3>Payment Failed</h3><p>Customer: ${data.email}</p><p>Amount: $${(data.amount/100).toFixed(2)}</p><p>Reason: ${data.reason}</p>`
    });
    addLog('Email sent');
    return true;
  } catch (err) {
    addLog('Email failed: ' + err.message);
    return false;
  }
}

async function addRecord(data) {
  try {
    await base('Failed Payments').create([{
      fields: {
        'Customer Email': data.email,
        'Payment Amount': data.amount / 100,
        'Failure Reason': data.reason,
        'Charge ID': data.chargeId,
        'Status': 'Failed'
      }
    }]);
    addLog('Record added to Airtable');
  } catch (err) {
    addLog('Airtable error: ' + err.message);
  }
}

app.get('/', (req, res) => {
  res.json({ status: 'running', name: 'Stripe Failed Payment Monitor' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

app.get('/logs', (req, res) => {
  res.json({ logs });
});

app.post('/test', async (req, res) => {
  const testData = {
    email: 'test@example.com',
    amount: 2000,
    reason: 'Test failure',
    chargeId: 'test_123'
  };
  
  await sendEmail(testData);
  res.json({ message: 'Test sent' });
});

app.post('/webhook', async (req, res) => {
  try {
    const event = JSON.parse(req.body);
    addLog('Webhook: ' + event.type);
    
    if (event.type === 'charge.failed') {
      const charge = event.data.object;
      const data = {
        email: charge.billing_details?.email || 'Unknown',
        amount: charge.amount,
        reason: charge.failure_message || 'Unknown',
        chargeId: charge.id
      };
      
      await sendEmail(data);
      await addRecord(data);
    }
    
    res.json({ received: true });
  } catch (err) {
    addLog('Webhook error: ' + err.message);
    res.status(400).json({ error: err.message });
  }
});

app.listen(process.env.PORT || 3000, () => {
  addLog('Server started');
});