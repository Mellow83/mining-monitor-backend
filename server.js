const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS
app.use(cors());
app.use(express.json());

// Storage in-memory
let cryptoData = [];
let lastUpdate = null;
let alerts = [];

// Configurazione crypto SHA-256
const BLOCK_TIME_CONFIG = {
  'BTC': 600,
  'BCH': 600,
  'XEC': 537,
  'DGB': 75,
  'FB': 15
};

// Funzione per ottenere dati Bitcoin da blockchain.info
async function getBitcoinData() {
  try {
    const [difficultyRes, hashrateRes] = await Promise.all([
      axios.get('https://blockchain.info/q/getdifficulty', { timeout: 10000 }),
      axios.get('https://blockchain.info/q/hashrate', { timeout: 10000 })
    ]);
    
    const difficulty = parseFloat(difficultyRes.data);
    const hashrateTH = parseFloat(hashrateRes.data);
    const hashrateEH = hashrateTH / 1000000;
    
    return {
      id: 'BTC',
      name: 'Bitcoin',
      symbol: 'BTC',
      algorithm: 'SHA-256',
      difficulty,
      networkHashrate: hashrateEH,
      blockReward: 3.125,
      blockTime: BLOCK_TIME_CONFIG['BTC'],
      dataSource: 'Blockchain.info API'
    };
  } catch (error) {
    console.error('Error fetching Bitcoin data:', error.message);
    return null;
  }
}

// Funzione per ottenere prezzi da CoinGecko
async function getCryptoPrices() {
  try {
    const response = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,bitcoin-cash,ecash,digibyte&vs_currencies=usd',
      { timeout: 10000 }
    );
    
    return {
      'BTC': response.data.bitcoin?.usd || 0,
      'BCH': response.data['bitcoin-cash']?.usd || 0,
      'XEC': response.data.ecash?.usd || 0,
      'DGB': response.data.digibyte?.usd || 0,
      'FB': 15 // Stimato per Fractal Bitcoin
    };
  } catch (error) {
    console.error('Error fetching prices from CoinGecko:', error.message);
    return { 'BTC': 0, 'BCH': 0, 'XEC': 0, 'DGB': 0, 'FB': 15 };
  }
}

// Funzione per ottenere dati da Blockchair
async function getBlockchairData(crypto) {
  try {
    const cryptoMap = {
      'BCH': 'bitcoin-cash',
      'XEC': 'ecash'
    };
    
    const cryptoName = cryptoMap[crypto];
    if (!cryptoName) return null;
    
    const response = await axios.get(
      `https://api.blockchair.com/${cryptoName}/stats`,
      { timeout: 10000 }
    );
    
    const stats = response.data.data;
    const difficulty = parseFloat(stats.difficulty);
    const hashrate = parseFloat(stats.hashrate_24h) || 0;
    const hashrateEH = hashrate / 1e18;
    
    const rewards = {
      'BCH': 3.125,
      'XEC': 1812500
    };
    
    return {
      id: crypto,
      name: crypto === 'BCH' ? 'Bitcoin Cash' : 'eCash',
      symbol: crypto,
      algorithm: 'SHA-256',
      difficulty,
      networkHashrate: hashrateEH,
      blockReward: rewards[crypto],
      blockTime: BLOCK_TIME_CONFIG[crypto],
      dataSource: 'Blockchair API'
    };
  } catch (error) {
    console.error(`Error fetching ${crypto} data from Blockchair:`, error.message);
    return null;
  }
}

// Funzione per fare scraping di solopool.org
async function scrapeSoloPool(cryptoId) {
  try {
    const urlMap = {
      'DGB': 'https://dgb-sha.solopool.org',
      'FB': 'https://fb.solopool.org'
    };
    
    const nameMap = {
      'DGB': 'DigiByte',
      'FB': 'Fractal Bitcoin'
    };
    
    const url = urlMap[cryptoId];
    if (!url) return null;
    
    console.log(`🔍 Scraping ${cryptoId} from ${url}...`);
    
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const $ = cheerio.load(response.data);
    
    // Cerca i dati nella tabella o nei div
    let difficulty = 0;
    let networkHashrate = 0;
    let blockReward = 0;
    
    // Prova diversi selettori comuni per solopool
    $('body').find('*').each((i, elem) => {
      const text = $(elem).text().toLowerCase();
      
      // Difficulty
      if (text.includes('difficulty') || text.includes('diff')) {
        const nextText = $(elem).next().text() || $(elem).parent().text();
        const diffMatch = nextText.match(/[\d,.]+/);
        if (diffMatch && difficulty === 0) {
          difficulty = parseFloat(diffMatch[0].replace(/,/g, ''));
        }
      }
      
      // Network Hashrate
      if (text.includes('network hashrate') || text.includes('nethash')) {
        const nextText = $(elem).next().text() || $(elem).parent().text();
        const hashMatch = nextText.match(/([\d,.]+)\s*(TH|EH|PH)/i);
        if (hashMatch) {
          let hash = parseFloat(hashMatch[1].replace(/,/g, ''));
          const unit = hashMatch[2].toUpperCase();
          // Converti tutto in EH/s
          if (unit === 'TH') hash = hash / 1000000;
          else if (unit === 'PH') hash = hash / 1000;
          if (networkHashrate === 0) networkHashrate = hash;
        }
      }
      
      // Block Reward
      if (text.includes('block reward') || text.includes('reward')) {
        const nextText = $(elem).next().text() || $(elem).parent().text();
        const rewardMatch = nextText.match(/[\d,.]+/);
        if (rewardMatch && blockReward === 0) {
          blockReward = parseFloat(rewardMatch[0].replace(/,/g, ''));
        }
      }
    });
    
    // Fallback ai valori noti se lo scraping fallisce parzialmente
    if (blockReward === 0) {
      blockReward = cryptoId === 'DGB' ? 283 : 25;
    }
    
    // Se abbiamo almeno la difficoltà, consideriamo il risultato valido
    if (difficulty > 0) {
      console.log(`✅ Scraped ${cryptoId}: difficulty=${difficulty}, hashrate=${networkHashrate}`);
      
      return {
        id: cryptoId,
        name: nameMap[cryptoId],
        symbol: cryptoId,
        algorithm: 'SHA-256',
        difficulty,
        networkHashrate: networkHashrate || 0.1, // Fallback se non trovato
        blockReward,
        blockTime: BLOCK_TIME_CONFIG[cryptoId],
        dataSource: 'SoloPool.org (Scraping)'
      };
    } else {
      console.error(`❌ Failed to scrape ${cryptoId}: no difficulty found`);
      return null;
    }
    
  } catch (error) {
    console.error(`Error scraping ${cryptoId} from solopool:`, error.message);
    return null;
  }
}

// Funzione principale per raccogliere tutti i dati
async function fetchAllCryptoData() {
  try {
    console.log('🔄 Fetching crypto data from multiple sources...');
    
    // Ottieni prezzi
    const prices = await getCryptoPrices();
    
    // Ottieni dati crypto in parallelo
    const [btcData, bchData, xecData, dgbData, fbData] = await Promise.all([
      getBitcoinData(),
      getBlockchairData('BCH'),
      getBlockchairData('XEC'),
      scrapeSoloPool('DGB'),
      scrapeSoloPool('FB')
    ]);
    
    // Combina tutto
    const newCryptoData = [btcData, bchData, xecData, dgbData, fbData]
      .filter(data => data !== null)
      .map(crypto => {
        // Calcola variazione 24h
        const oldData = cryptoData.find(c => c.id === crypto.id);
        let diffChange24h = '0.00';
        
        if (oldData && oldData.difficulty > 0) {
          const change = ((crypto.difficulty - oldData.difficulty) / oldData.difficulty * 100);
          diffChange24h = change.toFixed(2);
          
          // Alert se calo > 0.5%
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
    
    if (newCryptoData.length >= 3) { // Almeno 3 crypto devono funzionare
      cryptoData = newCryptoData;
      lastUpdate = new Date().toISOString();
      console.log(`✅ Data updated successfully. Found ${cryptoData.length} coins.`);
      console.log('Sources:', newCryptoData.map(c => `${c.symbol}:${c.dataSource}`).join(', '));
      return true;
    } else {
      console.error('❌ Not enough crypto data fetched');
      return false;
    }
    
  } catch (error) {
    console.error('❌ Error in fetchAllCryptoData:', error.message);
    return false;
  }
}

// Endpoint API
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
    coinsCount: cryptoData.length,
    message: success ? 'Data refreshed successfully' : 'Failed to refresh data'
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
    name: 'Mining Monitor Backend v3.0',
    status: 'running',
    features: ['Blockchain.info API', 'Blockchair API', 'SoloPool Scraping', 'CoinGecko Prices'],
    endpoints: {
      health: '/health',
      coins: '/api/coins',
      alerts: '/api/alerts',
      refresh: '/api/refresh (POST)'
    }
  });
});

// Fetch iniziale
console.log('🚀 Starting Mining Monitor Backend v3.0...');
console.log('📊 Data sources: Blockchain.info + Blockchair + SoloPool Scraping');
fetchAllCryptoData();

// Aggiorna ogni 5 minuti
setInterval(fetchAllCryptoData, 5 * 60 * 1000);

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🔄 Auto-refresh every 5 minutes`);
  console.log(`🌐 Ready to accept connections`);
});
