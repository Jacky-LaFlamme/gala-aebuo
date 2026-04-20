const express    = require('express');
const { v4: uuidv4 } = require('uuid');
const QRCode     = require('qrcode');
const nodemailer = require('nodemailer');
const path       = require('path');
const fs         = require('fs');

const app       = express();
const PORT      = process.env.PORT || 8080;
const ADMIN_KEY = 'aebuo2026admin';
const BASE_URL  = 'https://gala-aebuo-production.up.railway.app';

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  auth: {
    user: 'aebuo.uobsa@gmail.com',
    pass: 'frgtxwsovdlkblyt',
  },
});

const DB = path.join(__dirname, 'db', 'orders.json');
if (!fs.existsSync(path.join(__dirname, 'db'))) fs.mkdirSync(path.join(__dirname, 'db'));
if (!fs.existsSync(DB)) fs.writeFileSync(DB, '[]');

const getOrders   = ()      => JSON.parse(fs.readFileSync(DB));
const saveOrders  = (list)  => fs.writeFileSync(DB, JSON.stringify(list, null, 2));
const findOrder   = (id)    => getOrders().find(o => o.id === id);
const updateOrder = (id, p) => {
  const list = getOrders();
  const i = list.findIndex(o => o.id === id);
  if (i === -1) return null;
  list[i] = { ...list[i], ...p };
  saveOrders(list);
  return list[i];
};

app.use(express.json());
app.use(express.static(__dirname));

app.get('/',      (_, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (_, res) => res.sendFile(path.join(__dirname, 'admin.html')));

app.post('/api/register', async (req, res) => {
  const { prenom, nom, email, nationalite, allergie, nombre_billets } = req.body;
  if (!prenom || !nom || !email) return res.status(400).json({ error: 'Champs manquants' });

  const qty = Math.max(1, Math.min(10, parseInt(nombre_billets) || 1));
  const order = {
    id: uuidv4(), ref: uuidv4().split('-')[0].toUpperCase(),
    prenom: prenom.trim(), nom: nom.trim(),
    email: email.trim().toLowerCase(),
    nationalite: nationalite || 'Non précisé',
    allergie: allergie?.trim() || 'Aucune',
    nombre_billets: qty, montant: qty * 30,
    statut: 'en_attente', qr_token: null, qr_image: null,
    created_at: new Date().toISOString(), paid_at: null,
  };

  const list = getOrders(); list.push(order); saveOrders(list);

  try {
    await transporter.sendMail({
      from: '"AEBUO Gala 2026" <aebuo.uobsa@gmail.com>',
      to: order.email,
      subject: `[Réf. ${order.ref}] Votre réservation — Gala AEBUO 2026`,
      html: `<div style="font-family:Georgia,serif;background:#0a0a0a;padding:20px;">
        <div style="max-width:560px;margin:auto;background:#111;border:1px solid #C9A227;border-radius:12px;overflow:hidden;">
        <div style="background:#1a1200;padding:30px;text-align:center;border-bottom:2px solid #C9A227;">
        <h1 style="color:#C9A227;margin:0;letter-spacing:3px;">GALA AEBUO 2026</h1>
        <p style="color:#F5E6C8;font-style:italic;">Burkina en Scène — 16 mai 2026</p></div>
        <div style="padding:28px;">
        <p style="color:#F5E6C8;">Bonjour <strong style="color:#C9A227">${order.prenom} ${order.nom}</strong>,</p>
        <div style="background:rgba(201,162,39,.08);border:1px solid rgba(201,162,39,.3);border-radius:6px;padding:16px;text-align:center;margin:16px 0;">
        <div style="color:rgba(245,230,200,.4);font-size:10px;letter-spacing:3px;">VOTRE RÉFÉRENCE — À CONSERVER</div>
        <div style="font-family:monospace;font-size:28px;letter-spacing:6px;color:#C9A227;">${order.ref}</div></div>
        <p style="color:#F5E6C8;"><strong style="color:#C9A227">Billets :</strong> ${order.nombre_billets} × 30$ = ${order.montant}$</p>
        <p style="color:#C9A227;font-weight:bold;">Instructions Interac :</p>
        <p style="color:#F5E6C8;">1. Envoyez <strong>${order.montant}$</strong> à <strong>aebuo.gala2026@gmail.com</strong></p>
        <p style="color:#F5E6C8;">2. Dans le message écrivez : <strong>${order.ref}</strong></p>
        <p style="color:#F5E6C8;">3. Mot de passe si demandé : <strong>GALA2026</strong></p>
        <p style="color:rgba(245,230,200,.5);font-size:12px;">Vous recevrez votre billet QR par email une fois le paiement confirmé.</p>
        </div></div></div>`,
    });
  } catch(e) { console.warn('Email non envoyé:', e.message); }

  res.json({ success: true, ref: order.ref, montant: order.montant });
});

app.post('/api/admin/confirm/:id', async (req, res) => {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(401).json({ error: 'Non autorisé' });
  const order = findOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Introuvable' });
  if (order.statut === 'confirme') return res.status(400).json({ error: 'Déjà confirmée' });

  const qr_token  = uuidv4();
  const qrDataUrl = await QRCode.toDataURL(`${BASE_URL}/verify/${qr_token}`, { width: 280, margin: 2 });
  const updated = updateOrder(order.id, { statut: 'confirme', qr_token, paid_at: new Date().toISOString(), qr_image: qrDataUrl });

  try {
    await transporter.sendMail({
      from: '"AEBUO Gala 2026" <aebuo.uobsa@gmail.com>',
      to: updated.email,
      subject: `✅ [Réf. ${updated.ref}] Paiement confirmé — Votre billet Gala AEBUO 2026`,
      html: `<div style="font-family:Georgia,serif;background:#0a0a0a;padding:20px;">
        <div style="max-width:560px;margin:auto;background:#111;border:1px solid #C9A227;border-radius:12px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#1a1200,#2a1a00);padding:36px;text-align:center;border-bottom:2px solid #C9A227;">
        <div style="font-size:44px;">★</div>
        <h1 style="color:#C9A227;margin:8px 0;letter-spacing:3px;">PAIEMENT CONFIRMÉ</h1>
        <p style="color:#F5E6C8;font-style:italic;">Gala AEBUO 2026 — Burkina en Scène</p></div>
        <div style="padding:28px;">
        <p style="color:#F5E6C8;">Bonjour <strong style="color:#C9A227">${updated.prenom} ${updated.nom}</strong>, votre place est confirmée !</p>
        <p style="color:#F5E6C8;"><strong style="color:#C9A227">Réf :</strong> ${updated.ref} | <strong style="color:#C9A227">Billets :</strong> ${updated.nombre_billets} | <strong style="color:#C9A227">Montant :</strong> ${updated.montant}$</p>
        <div style="text-align:center;margin:24px 0;">
        <p style="color:#C9A227;font-weight:bold;">Votre billet QR — présentez-le à l'entrée</p>
        <img src="${qrDataUrl}" width="200" style="border:3px solid #C9A227;border-radius:8px;padding:10px;background:#fff;">
        </div>
        <div style="background:rgba(201,162,39,.06);border:1px solid rgba(201,162,39,.15);border-radius:8px;padding:16px;text-align:center;">
        <p style="color:#C9A227;margin:4px 0;"><strong>📅 16 mai 2026</strong> · À partir de 17h00</p>
        <p style="color:#F5E6C8;margin:4px 0;">📍 Tabaret Hall — Université d'Ottawa</p>
        </div></div></div></div>`,
    });
  } catch(e) { console.warn('Email QR non envoyé:', e.message); }

  res.json({ success: true, order: updated, qr: qrDataUrl });
});

app.post('/api/admin/cancel/:id', (req, res) => {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(401).json({ error: 'Non autorisé' });
  const order = findOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Introuvable' });
  updateOrder(order.id, { statut: 'annule' });
  res.json({ success: true });
});

app.get('/api/admin/orders', (req, res) => {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(401).json({ error: 'Non autorisé' });
  const orders = getOrders();
  res.json({
    orders: [...orders].reverse(),
    stats: {
      total: orders.length,
      en_attente: orders.filter(o => o.statut === 'en_attente').length,
      confirmes:  orders.filter(o => o.statut === 'confirme').length,
      billets:    orders.filter(o => o.statut === 'confirme').reduce((s,o) => s + o.nombre_billets, 0),
      revenus:    orders.filter(o => o.statut === 'confirme').reduce((s,o) => s + o.montant, 0),
    }
  });
});

app.post('/api/get-ticket', (req, res) => {
  const { ref, email } = req.body;
  const order = getOrders().find(o => o.ref === ref?.toUpperCase().trim() && o.email === email?.toLowerCase().trim());
  if (!order)                        return res.status(404).json({ error: 'Introuvable' });
  if (order.statut === 'en_attente') return res.status(202).json({ statut: 'en_attente' });
  if (order.statut === 'annule')     return res.status(410).json({ statut: 'annule' });
  res.json({ success: true, order, qr: order.qr_image });
});

app.get('/verify/:token', (req, res) => {
  const order = getOrders().find(o => o.qr_token === req.params.token);
  if (!order || order.statut !== 'confirme') return res.send('<h2 style="color:red;text-align:center;margin-top:100px">❌ Billet invalide</h2>');
  const d = new Date(o.paid_at).toLocaleString('fr-CA', { timeZone: 'America/Toronto' });
  res.send(`<div style="font-family:sans-serif;text-align:center;margin-top:80px;color:#111">
    <div style="font-size:52px">✅</div><h2 style="color:#C9A227">BILLET VALIDE</h2>
    <p><strong>${order.prenom} ${order.nom}</strong></p>
    <p>${order.nombre_billets} billet(s) — ${order.montant}$</p>
    <p>Confirmé le : ${d}</p></div>`);
});

app.listen(PORT, () => console.log(`✅ Serveur démarré sur le port ${PORT}`));
