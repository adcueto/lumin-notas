# LUMIN NOTAS — Ingresos por servicio y especialista

Hermana de LUMIN TICKETS: mismo motor (foto → Claude → revisión → guardar),
pero para **ingresos** (notas de remisión de servicios), no gastos.
Corre en el mismo VPS, puerto distinto (3001), su propia base de datos.

## 1. Base de datos

```bash
sudo -u postgres psql
```
```sql
CREATE USER lumin_notas WITH PASSWORD 'una-password-nueva';
CREATE DATABASE lumin_notas OWNER lumin_notas;
\q
```
```bash
psql -U lumin_notas -d lumin_notas -h localhost -f schema.sql
```

## 2. Instalar

```bash
mkdir -p /var/www/lumin-notas
# sube los archivos (FileZilla o unzip) a esa carpeta
cd /var/www/lumin-notas
npm install
cp .env.example .env
nano .env
```

Llena el `.env`:
- `ANTHROPIC_API_KEY`: **usa una llave separada** de la de lumin-tickets (créala en
  platform.claude.com nombrada `lumin-notas`) — así un incidente en una app no apaga la otra.
- `DATABASE_URL`: con la password que creaste arriba.
- `SESSION_SECRET`: genera uno nuevo con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- `PORT=3001` (lumin-tickets ya usa el 3000).

Crea tu usuario:
```bash
node crear-usuario.js admin "Adrian" "tuPassword"
```

Prueba:
```bash
npm start   # debe decir: LUMIN notas en :3001
```

## 3. Servicio systemd

`/etc/systemd/system/lumin-notas.service`:
```ini
[Unit]
Description=LUMIN notas de remisión
After=network.target postgresql.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/lumin-notas
ExecStart=/usr/bin/node server.js
Restart=always
EnvironmentFile=/var/www/lumin-notas/.env

[Install]
WantedBy=multi-user.target
```
```bash
chown -R www-data:www-data /var/www/lumin-notas
systemctl daemon-reload
systemctl enable --now lumin-notas
systemctl status lumin-notas
```

## 4. DNS + Nginx + HTTPS

En el panel de DNS donde vive tu dominio `luminbeauty.mx` (o donde lo tengas),
crea igual que hiciste con `tickets`:
```
Tipo: A   Nombre: notas   Valor: 66.179.92.68
```

`/etc/nginx/sites-available/notas.luminbeauty.mx`:
```nginx
server {
    server_name notas.luminbeauty.mx;
    client_max_body_size 10M;
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
```bash
ln -s /etc/nginx/sites-available/notas.luminbeauty.mx /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d notas.luminbeauty.mx
```

Si el DNS acaba de crearse, espera propagación (el mismo tema que ya viviste
con `tickets.luminbelleza.com`) antes de que certbot pase.

## Diferencias clave contra lumin-tickets

- Guarda **ingresos**, no gastos: cliente + especialista + servicio + precio.
- Un solo folio por nota (no por proveedor), único salvo "SN".
- 3 formas de pago: Efectivo, Tarjeta, Transferencia.
- Dashboard: ingresos por día, por especialista, servicios más vendidos,
  clientas más frecuentes — pensado para comisiones y desempeño, no para gasto.
- Puerto 3001 para no chocar con lumin-tickets (3000).
