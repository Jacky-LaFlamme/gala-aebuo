const express = require('express');
const { v4: uuidv4 } = require('uuid');
const QRCode  = require('qrcode');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = 3000;
const ADMIN_KEY = 'aebuo2026admin';
const BASE_URL = 'https://gala-aebuo-production.up.railway.app';

// ── Base de données JSON ──────────────────────────────────────────────────────
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

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── ROUTES ────────────────────────────────────────────────────────────────────

app.get('/',      (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (_, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// Enregistrer une réservation
app.post('/api/register', (req, res) => {
  const { prenom, nom, email, nationalite, allergie, nombre_billets } = req.body;
  if (!prenom || !nom || !email) return res.status(400).json({ error: 'Champs manquants' });

  const qty = Math.max(1, Math.min(10, parseInt(nombre_billets) || 1));
  const order = {
    id:             uuidv4(),
    ref:            uuidv4().split('-')[0].toUpperCase(),
    prenom:         prenom.trim(),
    nom:            nom.trim(),
    email:          email.trim().toLowerCase(),
    nationalite:    nationalite || 'Non précisé',
    allergie:       allergie?.trim() || 'Aucune',
    nombre_billets: qty,
    montant:        qty * 30,
    statut:         'en_attente',
    qr_token:       null,
    created_at:     new Date().toISOString(),
    paid_at:        null,
  };

  const list = getOrders();
  list.push(order);
  saveOrders(list);

  res.json({ success: true, ref: order.ref, montant: order.montant });
});

// Confirmer un paiement (admin)
app.post('/api/admin/confirm/:id', async (req, res) => {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(401).json({ error: 'Non autorisé' });

  const order = findOrder(req.params.id);
  if (!order)                    return res.status(404).json({ error: 'Introuvable' });
  if (order.statut === 'confirme') return res.status(400).json({ error: 'Déjà confirmée' });

  const qr_token  = uuidv4();
  const qrDataUrl = await QRCode.toDataURL(`${BASE_URL}/verify/${qr_token}`, { width: 280, margin: 2 });

  const updated = updateOrder(order.id, {
    statut:    'confirme',
    qr_token,
    paid_at:   new Date().toISOString(),
    qr_image:  qrDataUrl,
  });

  res.json({ success: true, order: updated, qr: qrDataUrl });
});

// Annuler
app.post('/api/admin/cancel/:id', (req, res) => {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(401).json({ error: 'Non autorisé' });
  const order = findOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Introuvable' });
  updateOrder(order.id, { statut: 'annule' });
  res.json({ success: true });
});

// Liste admin
app.get('/api/admin/orders', (req, res) => {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(401).json({ error: 'Non autorisé' });
  const orders = getOrders();
  res.json({
    orders: [...orders].reverse(),
    stats: {
      total:        orders.length,
      en_attente:   orders.filter(o => o.statut === 'en_attente').length,
      confirmes:    orders.filter(o => o.statut === 'confirme').length,
      billets:      orders.filter(o => o.statut === 'confirme').reduce((s,o) => s + o.nombre_billets, 0),
      revenus:      orders.filter(o => o.statut === 'confirme').reduce((s,o) => s + o.montant, 0),
    }
  });
});

// QR du participant (il peut le voir en entrant sa réf + email)
app.post('/api/get-ticket', (req, res) => {
  const { ref, email } = req.body;
  const order = getOrders().find(o =>
    o.ref === ref?.toUpperCase().trim() &&
    o.email === email?.toLowerCase().trim()
  );
  if (!order)                      return res.status(404).json({ error: 'Réservation introuvable' });
  if (order.statut === 'en_attente') return res.status(202).json({ statut: 'en_attente' });
  if (order.statut === 'annule')     return res.status(410).json({ statut: 'annule' });
  res.json({ success: true, order, qr: order.qr_image });
});

// Vérification QR (scan à l'entrée)
app.get('/verify/:token', (req, res) => {
  const order = getOrders().find(o => o.qr_token === req.params.token);
  if (!order || order.statut !== 'confirme') {
    return res.send(verifyHTML(false, null));
  }
  res.send(verifyHTML(true, order));
});

function verifyHTML(valid, o) {
  if (!valid) return `<!DOCTYPE html><html><head><meta charset="utf-8">
    <style>body{font-family:sans-serif;background:#080808;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
    .b{background:#1a1a1a;border:2px solid #CC2200;border-radius:12px;padding:40px;text-align:center;color:#fff;max-width:380px;}
    h2{color:#ff6b6b;}</style></head>
    <body><div class="b"><div style="font-size:52px">❌</div><h2>Billet invalide</h2>
    <p style="color:rgba(255,255,255,.5)">QR non reconnu ou paiement non confirmé.</p></div></body></html>`;

  const d = new Date(o.paid_at).toLocaleString('fr-CA', { timeZone: 'America/Toronto' });
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
    <link href="https://fonts.googleapis.com/css2?family=Josefin+Sans:wght@400;600&family=Cormorant+Garamond:wght@700&display=swap" rel="stylesheet">
    <style>body{font-family:'Josefin Sans',sans-serif;background:#080808;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;}
    .b{background:#111;border:2px solid #C9A227;border-radius:12px;padding:40px;text-align:center;max-width:420px;width:100%;}
    h2{font-family:'Cormorant Garamond',serif;color:#C9A227;font-size:28px;margin:10px 0 20px;}
    .row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.07);font-size:14px;}
    .row span:first-child{color:rgba(245,230,200,.4);font-size:10px;letter-spacing:2px;}
    .row span:last-child{color:#F5E6C8;font-weight:600;}</style></head>
    <body><div class="b">
      <div style="font-size:52px">✅</div>
      <h2>BILLET VALIDE</h2>
      <div class="row"><span>NOM</span><span>${o.prenom} ${o.nom}</span></div>
      <div class="row"><span>BILLETS</span><span>${o.nombre_billets}</span></div>
      <div class="row"><span>NATIONALITÉ</span><span>${o.nationalite}</span></div>
      <div class="row"><span>ALLERGIE</span><span>${o.allergie}</span></div>
      <div class="row"><span>CONFIRMÉ LE</span><span>${d}</span></div>
    </div></body></html>`;
}

app.listen(PORT, () => {
  console.log('\n✅  Gala AEBUO 2026 — Serveur démarré');
  console.log(`    → Site    : http://localhost:${PORT}`);
  console.log(`    → Admin   : http://localhost:${PORT}/admin`);
  console.log(`    → Clé     : ${ADMIN_KEY}\n`);
});
