const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Servir archivos estáticos
app.use(express.static(path.join(__dirname)));

// Ruta raíz
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Fallback para rutas no encontradas
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n════════════════════════════════════════`);
  console.log(`✅ F.R.A Web Server iniciado`);
  console.log(`🌐 http://localhost:${PORT}`);
  console.log(`════════════════════════════════════════\n`);
});
