const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

let cryptoData = [];
let lastUpdate = null;
let alerts = [];

// Configurazione base
const CRYPTO_CONFIG = {
  'BTC': { name: 'Bitcoin', blockReward: 3.125, blockTime: 600 },
  'BCH': { name: 'Bitcoin Cash', blockReward: 3.125, blockTime: 600 },
  'XEC': { name: 'eCash', blockReward: 1812500, blockTime: 537 },
  'DGB': { name: 'DigiByte', blockReward: 283, blockTime: 75 },
  'FB': { name: 'Fractal Bitcoin', blockReward: 25, blockTime: 15 }
};

// Funzione per Bitcoin da mempool.space (più affidabile)
async function getBitcoinData() {
  try {
    console.log('📡 Fetching BTC from mempool.space...');
    
    // Prova mempool.space API
    const response = await axios.get('https://mempool.space/api/v1/difficulty-adjustment', {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    
    const data = response.data;
    const difficulty = data.currentDifficulty || 0;
    
    // Stima hashrate da difficoltà (formula: difficulty * 2^32 / 600 / 10^12)
    const hashrateEH = (difficulty * Math.pow(2, 32) / 600) / 1e18;
    
    return {
      id: 'BTC',
      name: 'Bitcoin',
      symbol: 'BTC',
      difficulty,
      networkHashrate: hashrateEH,
      blockReward: 3.125,
      blockTime: 600,
      dataSource: 'Mempool.space'
    };
  } catch (error) {
    console.error('❌ Error fetching BTC:', error.message);
    
    // Fallback: usa blockchain.com (diverso da blockchain.info)
    try {
      const response = await axios.get('https://blockchain.com/q/getdifficulty', {
        timeout: 10000
      });
      const difficulty = parseFloat(response.data);
      const hashrateEH = (difficulty * Math.pow(2, 32) / 600) / 1e18;
      
      return {
        id: 'BTC',
        name: 'Bitcoin',
        symbol: 'BTC',
        difficulty,
        networkHashrate: hashrateEH,
        blockReward: 3.125,
        blockTime: 600,
        dataSource: 'Blockchain.com'
      };
    } catch (err2) {
      console.error('❌ BTC fallback also failed:', err2.message);
      return null;
    }
  }
}

// Funzione per prezzi con retry e fallback
async function getCryptoPrices() {
  // Prova prima CoinGecko con delay
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  try {
    console.log('💰 Fetching prices from CoinGecko...');
    const response = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,bitcoin-cash,ecash,digibyte&vs_currencies=usd',
      { 
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      }
    );
    
    return {
      'BTC': response.data.bitcoin?.usd || 90000,
      'BCH': response.data['bitcoin-cash']?.usd || 450,
      'XEC': response.data.ecash?.usd || 0.00003,
      'DGB': response.data.digibyte?.usd || 0.012,
      'FB': 15
    };
  } catch (error) {
    console.log('⚠️ CoinGecko failed, using fallback prices');
    // Prezzi di fallback realistici
    return {
      'BTC': 92000,
      'BCH': 450,
      'XEC': 0.00003,
      'DGB': 0.012,
      'FB': 15
    };
  }
}

// Funzione per altre crypto da Blockchair
async function getBlockchairData(crypto) {
  try {
    const cryptoMap = {
      'BCH': 'bitcoin-cash',
      'XEC': 'ecash'
    };
    
    const cryptoName = cryptoMap[crypto];
    if (!cryptoName) return null;
    
    console.log(`📡 Fetching ${crypto} from Blockchair...`);
    
    const response = await axios.get(
      `https://api.blockchair.com/${cryptoName}/stats`,
      { 
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      }
    );
    
    const stats = response.data.data;
    const difficulty = parseFloat(stats.difficulty) || 0;
    const hashrate = parseFloat(stats.hashrate_24h) || 0;
    const hashrateEH = hashrate / 1e18;
    
    const config = CRYPTO_CONFIG[crypto];
    
    return {
      id: crypto,
      name: config.name,
      symbol: crypto,
      difficulty,
      networkHashrate: hashrateEH,
      blockReward: config.blockReward,
      blockTime: config.blockTime,
      dataSource: 'Blockchair'
    };
  } catch (error) {
    console.error(`❌ Error fetching ${crypto}:`, error.message);
    return null;
  }
}

// Funzione per DGB e FB - usa API di pool mining
async function getPoolData(crypto) {
  try {
    // Per DGB e FB, provo diverse fonti
    
    if (crypto === 'DGB') {
      console.log('📡 Fetching DGB from mining pool stats...');
      
      // Prova a ottenere dati da API pool pubbliche
      // Molti pool espongono statistiche JSON
      try {
        const response = await axios.get('https://dgb-sha.solopool.org/api/stats', {
          timeout: 10000,
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        
        if (response.data && response.data.network) {
          const difficulty = parseFloat(response.data.network.difficulty) || 0;
          const hashrate = parseFloat(response.data.network.hashrate) || 0;
          
          return {
            id: 'DGB',
            name: 'DigiByte',
            symbol: 'DGB',
            difficulty,
            networkHashrate: hashrate / 1e18,
            blockReward: 283,
            blockTime: 75,
            dataSource: 'Pool API'
          };
        }
      } catch (err) {
        console.log('⚠️ DGB pool API failed, using estimates');
      }
      
      // Fallback a stime ragionevoli basate su dati storici
      return {
        id: 'DGB',
        name: 'DigiByte',
        symbol: 'DGB',
        difficulty: 15000000000,
        networkHashrate: 0.11,
        blockReward: 283,
        blockTime: 75,
        dataSource: 'Recent Estimates'
      };
    }
    
    if (crypto === 'FB') {
      console.log('📡 Fetching FB from mining pool stats...');
      
      try {
        const response = await axios.get('https://fb.solopool.org/api/stats', {
          timeout: 10000,
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        
        if (response.data && response.data.network) {
          const difficulty = parseFloat(response.data.network.difficulty) || 0;
          const hashrate = parseFloat(response.data.network.hashrate) || 0;
          
          return {
            id: 'FB',
            name: 'Fractal Bitcoin',
            symbol: 'FB',
            difficulty,
            networkHashrate: hashrate / 1e18,
            blockReward: 25,
            blockTime: 15,
            dataSource: 'Pool API'
          };
        }
      } catch (err) {
        console.log('⚠️ FB pool API failed, using estimates');
      }
      
      // Fallback
      return {
        id: 'FB',
        name: 'Fractal Bitcoin',
        symbol: 'FB',
        difficulty: 2400000000,
        networkHashrate: 0.017,
        blockReward: 25,
        blockTime: 15,
        dataSource: 'Recent Estimates'
      };
    }
    
    return null;
  } catch (error) {
    console.error(`❌ Error fetching ${crypto}:`, error.message);
    return null;
  }
}

// Funzione principale
async function fetchAllCryptoData() {
  try {
    console.log('🔄 Starting data fetch cycle...');
    
    // Ottieni prezzi (con delay per evitare rate limit)
    const prices = await getCryptoPrices();
    
    // Aggiungi delay tra richieste
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    
    // Fetch tutte le crypto con delay
    const btcData = await getBitcoinData();
    await delay(1000);
    
    const bchData = await getBlockchairData('BCH');
    await delay(1000);
    
    const xecData = await getBlockchairData('XEC');
    await delay(1000);
    
    const dgbData = await getPoolData('DGB');
    await delay(1000);
    
    const fbData = await getPoolData('FB');
    
    // Filtra e processa
    const newCryptoData = [btcData, bchData, xecData, dgbData, fbData]
      .filter(data => data !== null)
      .map(crypto => {
        const oldData = cryptoData.find(c => c.id === crypto.id);
        let diffChange24h = '0.00';
        
        if (oldData && oldData.difficulty > 0) {
          const change = ((crypto.difficulty - oldData.difficulty) / oldData.difficulty * 100);
          diffChange24h = change.toFixed(2);
          
          if (change < -0.5) {
            alerts.push({
              id: Date.now() + crypto.id,
              crypto: crypto.name,
              change: change.toFixed(2),
              timestamp: new Date().toISOString()
            });
            alerts = alerts.slice(-10);
          }
        }
        
        return {
          ...crypto,
          price: prices[crypto.id] || 0,
          diffChange24h,
          difficulty24: oldData?.difficulty || crypto.difficulty
        };
      });
    
    if (newCryptoData.length >= 3) { // Almeno 3 crypto
      cryptoData = newCryptoData;
      lastUpdate = new Date().toISOString();
      console.log(`✅ Updated ${cryptoData.length} coins successfully`);
      console.log('📊', cryptoData.map(c => `${c.symbol}:${c.dataSource}`).join(', '));
      return true;
    } else {
      console.error(`❌ Not enough data (got ${newCryptoData.length}/5)`);
      return false;
    }
    
  } catch (error) {
    console.error('❌ Fatal error in fetchAllCryptoData:', error.message);
    return false;
  }
}

// Endpoints
app.get('/api/coins', (req, res) => {
  res.json({
    success: true,
    lastUpdate,
    data: cryptoData
  });
});

app.get('/api/alerts', (req, res) => {
  res.json({
    success: true,
    alerts: alerts.slice(-5)
  });
});

app.post('/api/refresh', async (req, res) => {
  console.log('📡 Manual refresh requested');
  const success = await fetchAllCryptoData();
  res.json({
    success,
    lastUpdate,
    coinsCount: cryptoData.length
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    lastUpdate,
    coinsCount: cryptoData.length,
    coins: cryptoData.map(c => `${c.symbol} (${c.dataSource})`)
  });
});

app.get('/', (req, res) => {
  res.json({
    name: 'Mining Monitor Backend',
    version: '4.0',
    status: 'running',
    sources: [
      'BTC: Mempool.space / Blockchain.com',
      'BCH/XEC: Blockchair',
      'DGB/FB: Pool APIs + Fallback estimates',
      'Prices: CoinGecko + Fallbacks'
    ]
  });
});

// Start
console.log('🚀 Mining Monitor v4.0 starting...');
fetchAllCryptoData();
setInterval(fetchAllCryptoData, 10 * 60 * 1000); // Ogni 10 minuti per evitare rate limit

app.listen(PORT, () => {
  console.log(`✅ Server on port ${PORT}`);
  console.log(`🔄 Auto-refresh: 10 minutes`);
});
