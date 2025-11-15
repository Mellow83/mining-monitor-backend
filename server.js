const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS per permettere alla PWA di connettersi
app.use(cors());
app.use(express.json());

// Storage in-memory dei dati (in produzione useresti un DB)
let cryptoData = [];
let lastUpdate = null;
let alerts = [];

// Configurazione crypto SHA-256
const SHA256_COINS = ['BTC', 'BCH', 'XEC', 'DGB'];
const BLOCK_TIME_CONFIG = {
  'BTC': 600,
  'BCH': 600,
  'XEC': 537,
  'DGB': 75
};
const BLOCK_REWARD_CONFIG = {
  'BTC': 3.125,
  'BCH': 3.125,
  'XEC': 1812500,
  'DGB': 283
};

// Funzione per fare fetch da WhatToMine
async function fetchWhatToMineData() {
  try {
    console.log('Fetching data from WhatToMine API...');
    
    const response = await axios.get('https://whattomine.com/api/v1/coins', {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      }
    });

    const coins = response.data;
    const newCryptoData = [];

    // Processa ogni coin
    if (Array.isArray(coins)) {
      coins.forEach(coin => {
        if (SHA256_COINS.includes(coin.tag) && coin.algorithm === 'SHA-256') {
          
          const difficulty = parseFloat(coin.difficulty) || 0;
          const difficulty24 = parseFloat(coin.difficulty24) || difficulty;
          const diffChange24h = difficulty24 > 0 
            ? ((difficulty - difficulty24) / difficulty24 * 100).toFixed(2)
            : '0.00';
          
          const nethash = parseFloat(coin.nethash) || 0;
          const hashrateEH = nethash / 1e18;
          
          let price = 0;
          if (coin.exchanges && coin.exchanges.length > 0) {
            price = parseFloat(coin.exchanges[0].price) || 0;
          }
          
          const blockReward = BLOCK_REWARD_CONFIG[coin.tag] || 0;
          
          // Controlla se c'è un calo significativo
          const oldData = cryptoData.find(c => c.id === coin.tag);
          if (oldData && oldData.difficulty > 0) {
            const change = ((difficulty - oldData.difficulty) / oldData.difficulty * 100);
            if (change < -0.5) {
              alerts.push({
                id: Date.now() + coin.tag,
                crypto: coin.name,
                change: change.toFixed(2),
                timestamp: new Date().toISOString()
              });
              // Mantieni solo ultimi 10 alert
              alerts = alerts.slice(-10);
            }
          }
          
          newCryptoData.push({
            id: coin.tag,
            name: coin.name,
            symbol: coin.tag,
            algorithm: coin.algorithm,
            difficulty,
            difficulty24,
            diffChange24h,
            networkHashrate: hashrateEH,
            price,
            blockReward,
            blockTime: BLOCK_TIME_CONFIG[coin.tag] || 600,
            dataSource: 'WhatToMine API'
          });
        }
      });
    }

    // Aggiungi Fractal Bitcoin manualmente
    newCryptoData.push({
      id: 'FB',
      name: 'Fractal Bitcoin',
      symbol: 'FB',
      algorithm: 'SHA-256',
      difficulty: 2500000000,
      difficulty24: 2500000000,
      diffChange24h: '0.00',
      networkHashrate: 0.018,
      price: 15,
      blockReward: 25,
      blockTime: 15,
      dataSource: 'Dati Stimati'
    });

    cryptoData = newCryptoData;
    lastUpdate = new Date().toISOString();
    
    console.log(`Data updated successfully. Found ${cryptoData.length} coins.`);
    return true;
    
  } catch (error) {
    console.error('Error fetching WhatToMine data:', error.message);
    return false;
  }
}

// Endpoint per ottenere i dati delle crypto
app.get('/api/coins', (req, res) => {
  res.json({
    success: true,
    lastUpdate,
    data: cryptoData
  });
});

// Endpoint per ottenere gli alert
app.get('/api/alerts', (req, res) => {
  res.json({
    success: true,
    alerts: alerts.slice(-5) // Ultimi 5 alert
  });
});

// Endpoint per forzare aggiornamento
app.post('/api/refresh', async (req, res) => {
  const success = await fetchWhatToMineData();
  res.json({
    success,
    lastUpdate,
    message: success ? 'Data refreshed successfully' : 'Failed to refresh data'
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    lastUpdate,
    coinsCount: cryptoData.length
  });
});

// Fetch iniziale
fetchWhatToMineData();

// Aggiorna ogni 5 minuti
setInterval(fetchWhatToMineData, 5 * 60 * 1000);

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Mining Monitor Backend running on port ${PORT}`);
  console.log(`📊 Fetching data every 5 minutes from WhatToMine`);
});
