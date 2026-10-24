// ============================================================
// SUN.JS v2.0 - PHẦN 1/10: HEADER + CONFIG
// Endpoints: / | /api/sunwin/dudoan | /api/sunwin/history
//            /api/sunwin/stats | /api/sunwin/health
// ============================================================
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 5000;
const API_URL = 'https://apisunlon.onrender.com/sun';
const LEARNING_FILE = 'learning_data.json';
const HISTORY_FILE = 'prediction_history.json';
const DASHBOARD_FILE = 'dashboard.html';
const START_TIME = Date.now();
const VERSION = '2.0.0';
const ADMIN = '@cskhgiabao';

process.on('uncaughtException', (err) => {
  console.error('[Anti-Crash] Lỗi chưa xử lý:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Anti-Crash] Promise chưa xử lý:', reason);
});

const CONFIG = {
  STREAK_CONTINUE_THRESHOLD: 3,
  STREAK_BREAK_MIN: 5,
  STREAK_BREAK_STRONG: 7,
  DAO11_MIN_LENGTH: 4,
  DAO11_BREAK_LENGTH: 6,
  SUM_HIGH: 14,
  SUM_LOW: 7,
  SUM_MEAN: 10.5,
  MARKOV_STRONG_PROB: 0.60,
  MARKOV_WEAK_PROB: 0.55,
  MIN_CONFIDENCE: 52,
  MAX_CONFIDENCE: 88,
  REVERSAL_THRESHOLD: 3
};

const MAX_HISTORY = 100;
const AUTO_SAVE_INTERVAL = 5000;
let lastProcessedPhien = { b52: null };
let predictionHistory = { b52: [] };

let learningData = {
  b52: {
    predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0,
    patternWeights: {}, lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    adaptiveThresholds: {}, recentAccuracy: [],
    reversalState: { active: false, activatedAt: null, consecutiveLosses: 0, reversalCount: 0, lastReversalResult: null },
    transitionMatrix: { 'Tài->Tài': 0, 'Tài->Xỉu': 0, 'Xỉu->Tài': 0, 'Xỉu->Xỉu': 0 }
  }
};

const DEFAULT_PATTERN_WEIGHTS = {
  'cau_bet': 1.35, 'cau_dao_11': 1.25, 'cau_22': 1.20, 'cau_33': 1.25,
  'cau_44': 1.30, 'cau_55': 1.35, 'cau_121': 1.10, 'cau_123': 1.10,
  'cau_321': 1.15, 'cau_212': 1.10, 'cau_1221': 1.15, 'cau_2112': 1.15,
  'cau_nhay_coc': 0.95, 'cau_nhip_nghieng': 1.15, 'cau_3van1': 1.15,
  'cau_be_cau': 1.30, 'cau_chu_ky': 1.05, 'cau_gap': 1.05,
  'cau_ziczac': 1.15, 'cau_doi': 1.15, 'cau_rong': 1.40,
  'distribution': 0.85, 'dice_pattern': 1.00, 'sum_trend': 1.05,
  'edge_cases': 1.20, 'momentum': 1.15, 'cau_tu_nhien': 0.70,
  'dice_trend_line': 1.25, 'break_pattern': 1.35, 'fibonacci': 0.95,
  'resistance_support': 1.15, 'wave': 1.10, 'golden_ratio': 0.95,
  'day_gay': 1.30, 'smart_bet': 1.20, 'markov_chain': 1.15,
  'moving_avg_drift': 1.25, 'sum_pressure': 1.30, 'volatility': 1.15,
  'sun_hot_cold': 1.25, 'sun_streak_break': 1.40, 'sun_balance': 1.15,
  'sun_momentum_shift': 1.30
};
// ============================================================
// PHẦN 2/10: LOAD / SAVE LEARNING DATA + HISTORY
// ============================================================
function loadLearningData() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(LEARNING_FILE, 'utf8'));
      if (parsed.b52) learningData = { ...learningData, ...parsed };
      console.log('[Load] Learning data loaded');
    }
  } catch (e) { console.error('Load learning error:', e.message); }
}

let isSavingLearningData = false;
function saveLearningData() {
  if (isSavingLearningData) return;
  isSavingLearningData = true;
  fs.writeFile(LEARNING_FILE, JSON.stringify(learningData, null, 2), (err) => {
    isSavingLearningData = false;
    if (err) console.error('Save learning error:', err.message);
  });
}

function loadPredictionHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      if (parsed.history && parsed.history.b52) predictionHistory = parsed.history;
      else predictionHistory = { b52: [] };
      if (parsed.lastProcessedPhien && parsed.lastProcessedPhien.b52) lastProcessedPhien = parsed.lastProcessedPhien;
      console.log(`[Load] History: ${predictionHistory.b52.length} records`);
    }
  } catch (e) { console.error('Load history error:', e.message); }
}

let isSavingHistory = false;
function savePredictionHistory() {
  if (isSavingHistory) return;
  isSavingHistory = true;
  const dataToSave = { history: predictionHistory, lastProcessedPhien, lastSaved: new Date().toISOString() };
  fs.writeFile(HISTORY_FILE, JSON.stringify(dataToSave, null, 2), (err) => {
    isSavingHistory = false;
    if (err) console.error('Save history error:', err.message);
  });
}
// ============================================================
// PHẦN 3/10: FETCH DATA + CACHE + AUTO PROCESS
// ============================================================
let cacheData = null, lastFetchTime = 0, isFetchingAPI = false;

async function fetchData() {
  const now = Date.now();
  if (cacheData && (now - lastFetchTime < 1500)) return cacheData;
  if (isFetchingAPI) { await new Promise(r => setTimeout(r, 50)); return cacheData; }
  isFetchingAPI = true;
  try {
    const response = await axios.get(API_URL, { timeout: 4000 });
    const rawData = response.data;
    if (rawData && rawData.lich_su_phien) {
      const currentPhien = {
        Phien: rawData.phien_hien_tai, Ket_qua: rawData.ket_qua,
        xuc_xac_1: rawData.xuc_xac_1, xuc_xac_2: rawData.xuc_xac_2, xuc_xac_3: rawData.xuc_xac_3,
        tong: rawData.tong
      };
      const historyData = rawData.lich_su_phien.map(item => ({
        Phien: item.phien, Ket_qua: item.ket_qua,
        xuc_xac_1: item.xuc_xac_1, xuc_xac_2: item.xuc_xac_2, xuc_xac_3: item.xuc_xac_3,
        tong: item.tong
      }));
      const formattedData = { data: [currentPhien, ...historyData] };
      cacheData = formattedData;
      lastFetchTime = now;
      return formattedData;
    }
    return response.data;
  } catch (e) {
    console.error('[Fetch] Error:', e.message);
    return cacheData;
  } finally {
    isFetchingAPI = false;
  }
}

async function autoProcessPredictions() {
  try {
    const data = await fetchData();
    if (!data || !data.data || data.data.length === 0) return;
    const latestPhien = data.data[0].Phien;
    const nextPhien = latestPhien + 1;
    if (lastProcessedPhien.b52 !== nextPhien) {
      await verifyPredictions('b52', data.data);
      const result = calculateAdvancedPrediction(data.data, 'b52');
      savePredictionToHistory('b52', nextPhien, result.prediction, result.confidence);
      recordPrediction('b52', nextPhien, result.prediction, result.confidence, result.factors);
      lastProcessedPhien.b52 = nextPhien;
      console.log(`[Auto] Phiên ${nextPhien}: ${result.prediction} (${result.confidence}%)`);
    }
    savePredictionHistory();
    saveLearningData();
  } catch (e) { console.error('[Auto] Error:', e.message); }
}

function startAutoSaveTask() {
  console.log(`[Auto-save] every ${AUTO_SAVE_INTERVAL/1000}s`);
  setTimeout(() => autoProcessPredictions(), 5000);
  setInterval(() => autoProcessPredictions(), AUTO_SAVE_INTERVAL);
}
// ============================================================
// PHẦN 4/10: PATTERN STATS + WEIGHT MANAGEMENT
// ============================================================
function initializePatternStats(type) {
  if (!learningData[type].patternWeights || Object.keys(learningData[type].patternWeights).length === 0) {
    learningData[type].patternWeights = { ...DEFAULT_PATTERN_WEIGHTS };
  }
  Object.keys(DEFAULT_PATTERN_WEIGHTS).forEach(p => {
    if (!learningData[type].patternStats[p]) {
      learningData[type].patternStats[p] = { total: 0, correct: 0, accuracy: 0.5, recentResults: [], lastAdjustment: null };
    }
  });
}

function getPatternWeight(type, patternId) {
  initializePatternStats(type);
  const base = learningData[type].patternWeights[patternId] || 1.0;
  const stats = learningData[type].patternStats[patternId];
  if (!stats || stats.recentResults.length < 8) return base;
  const recentAcc = stats.recentResults.reduce((a, b) => a + b, 0) / stats.recentResults.length;
  if (recentAcc > 0.65 && stats.recentResults.length >= 10) return Math.min(2.0, base * 1.08);
  if (recentAcc < 0.35 && stats.recentResults.length >= 10) return Math.max(0.4, base * 0.92);
  return base;
}

function updatePatternPerformance(type, patternId, isCorrect) {
  initializePatternStats(type);
  const stats = learningData[type].patternStats[patternId];
  if (!stats) return;
  stats.total++;
  if (isCorrect) stats.correct++;
  stats.recentResults.push(isCorrect ? 1 : 0);
  if (stats.recentResults.length > 20) stats.recentResults.shift();
  const recentAcc = stats.recentResults.reduce((a, b) => a + b, 0) / stats.recentResults.length;
  stats.accuracy = stats.total > 0 ? stats.correct / stats.total : 0.5;
  const oldW = learningData[type].patternWeights[patternId];
  let newW = oldW;
  if (stats.recentResults.length >= 5) {
    if (recentAcc > 0.6) newW = Math.min(2.0, oldW * 1.05);
    else if (recentAcc < 0.4) newW = Math.max(0.3, oldW * 0.95);
  }
  learningData[type].patternWeights[patternId] = newW;
  stats.lastAdjustment = new Date().toISOString();
}

function getPatternIdFromName(name) {
  const map = {
    'Cầu Bệt': 'cau_bet', 'Cầu Đảo 1-1': 'cau_dao_11', 'Cầu 2-2': 'cau_22',
    'Cầu 3-3': 'cau_33', 'Cầu 4-4': 'cau_44', 'Cầu 5-5': 'cau_55',
    'Cầu 1-2-1': 'cau_121', 'Cầu 1-2-3': 'cau_123', 'Cầu 3-2-1': 'cau_321',
    'Cầu 2-1-2': 'cau_212', 'Cầu 1-2-2-1': 'cau_1221', 'Cầu 2-1-1-2': 'cau_2112',
    'Nhảy Cóc': 'cau_nhay_coc', 'Nhịp Nghiêng': 'cau_nhip_nghieng',
    '3 Ván 1': 'cau_3van1', 'Bẻ Cầu': 'cau_be_cau', 'Chu Kỳ': 'cau_chu_ky',
    'Cầu Gấp': 'cau_gap', 'Ziczac': 'cau_ziczac', 'Cầu Đôi': 'cau_doi',
    'Cầu Rồng': 'cau_rong', 'Đảo Xu Hướng': 'smart_bet', 'Xu Hướng Cực': 'smart_bet',
    'Phân bố': 'distribution', 'Tổng TB': 'dice_pattern', 'Xu hướng': 'sum_trend',
    'Cực Điểm': 'edge_cases', 'Biến động': 'momentum', 'Cầu Tự Nhiên': 'cau_tu_nhien',
    'Biểu Đồ Đường': 'dice_trend_line', 'Cầu Liên Tục': 'break_pattern',
    'Dây Gãy': 'day_gay', 'Markov': 'markov_chain', 'MA Drift': 'moving_avg_drift',
    'Áp Lực Tổng': 'sum_pressure', 'Sun Nóng': 'sun_hot_cold',
    'Sun Streak': 'sun_streak_break', 'Sun Cân Bằng': 'sun_balance',
    'Sun Đổi Chiều': 'sun_momentum_shift'
  };
  for (const [k, v] of Object.entries(map)) if (name.includes(k)) return v;
  return null;
}
// ============================================================
// PHẦN 5/10: RECORD / VERIFY / REVERSAL
// ============================================================
function recordPrediction(type, phien, prediction, confidence, patterns) {
  const record = {
    phien: phien.toString(), prediction, confidence, patterns,
    timestamp: new Date().toISOString(), verified: false, actual: null, isCorrect: null
  };
  learningData[type].predictions.unshift(record);
  learningData[type].totalPredictions++;
  if (learningData[type].predictions.length > 500) {
    learningData[type].predictions = learningData[type].predictions.slice(0, 500);
  }
  saveLearningData();
}

async function verifyPredictions(type, currentData) {
  let updated = false;
  for (const pred of learningData[type].predictions) {
    if (pred.verified) continue;
    const actual = currentData.find(d => d.Phien.toString() === pred.phien);
    if (actual) {
      pred.verified = true;
      pred.actual = actual.Ket_qua;
      const normalized = (pred.prediction === 'Tài' || pred.prediction === 'tai') ? 'Tài' : 'Xỉu';
      pred.isCorrect = pred.actual === normalized;

      if (pred.isCorrect) {
        learningData[type].correctPredictions++;
        learningData[type].streakAnalysis.wins++;
        if (learningData[type].streakAnalysis.currentStreak >= 0) learningData[type].streakAnalysis.currentStreak++;
        else learningData[type].streakAnalysis.currentStreak = 1;
        if (learningData[type].streakAnalysis.currentStreak > learningData[type].streakAnalysis.bestStreak) {
          learningData[type].streakAnalysis.bestStreak = learningData[type].streakAnalysis.currentStreak;
        }
        updateReversalState(type, true);
      } else {
        learningData[type].streakAnalysis.losses++;
        if (learningData[type].streakAnalysis.currentStreak <= 0) learningData[type].streakAnalysis.currentStreak--;
        else learningData[type].streakAnalysis.currentStreak = -1;
        if (learningData[type].streakAnalysis.currentStreak < learningData[type].streakAnalysis.worstStreak) {
          learningData[type].streakAnalysis.worstStreak = learningData[type].streakAnalysis.currentStreak;
        }
        updateReversalState(type, false);
      }
      learningData[type].recentAccuracy.push(pred.isCorrect ? 1 : 0);
      if (learningData[type].recentAccuracy.length > 50) learningData[type].recentAccuracy.shift();

      if (pred.patterns && pred.patterns.length > 0) {
        pred.patterns.forEach(p => {
          const pid = getPatternIdFromName(p);
          if (pid) updatePatternPerformance(type, pid, pred.isCorrect);
        });
      }
      updated = true;
    }
  }
  if (updated) {
    learningData[type].lastUpdate = new Date().toISOString();
    saveLearningData();
  }
}

function updateReversalState(type, isCorrect) {
  const rv = learningData[type].reversalState;
  if (!rv) return;
  if (isCorrect && rv.active) {
    rv.active = false; rv.lastReversalResult = 'success'; rv.consecutiveLosses = 0;
  }
  if (!isCorrect) rv.consecutiveLosses++;
  else rv.consecutiveLosses = 0;
}

function applyAutoReversal(type, prediction) {
  const rv = learningData[type].reversalState;
  const streak = learningData[type].streakAnalysis;
  if (!rv) return { prediction, reversed: false };
  if (streak.currentStreak <= -CONFIG.REVERSAL_THRESHOLD && !rv.active) {
    rv.active = true; rv.activatedAt = new Date().toISOString(); rv.reversalCount++;
  }
  if (rv.active) {
    const reversed = prediction === 'Tài' ? 'Xỉu' : 'Tài';
    return { prediction: reversed, reversed: true, originalPrediction: prediction };
  }
  return { prediction, reversed: false };
}

function getAdaptiveConfidenceBoost(type) {
  const recentAcc = learningData[type].recentAccuracy;
  if (recentAcc.length < 10) return 0;
  const accuracy = recentAcc.reduce((a, b) => a + b, 0) / recentAcc.length;
  if (accuracy > 0.65) return 5;
  if (accuracy > 0.55) return 2;
  if (accuracy < 0.4) return -5;
  if (accuracy < 0.45) return -2;
  return 0;
}

function getSmartPredictionAdjustment(type, prediction, patterns) {
  const s = learningData[type].streakAnalysis;
  if (s.currentStreak <= -5) return prediction === 'Tài' ? 'Xỉu' : 'Tài';
  let taiScore = 0, xiuScore = 0;
  patterns.forEach(p => {
    const pid = getPatternIdFromName(p.name || p);
    if (pid) {
      const stats = learningData[type].patternStats[pid];
      if (stats && stats.recentResults.length >= 5) {
        const acc = stats.recentResults.reduce((a, b) => a + b, 0) / stats.recentResults.length;
        const w = learningData[type].patternWeights[pid] || 1;
        if (p.prediction === 'Tài') taiScore += acc * w;
        else xiuScore += acc * w;
      }
    }
  });
  if (Math.abs(taiScore - xiuScore) > 0.5) return taiScore > xiuScore ? 'Tài' : 'Xỉu';
  return prediction;
}

function normalizeResult(r) {
  if (r === 'Tài' || r === 'tài') return 'tai';
  if (r === 'Xỉu' || r === 'xỉu') return 'xiu';
  return String(r).toLowerCase();
}
// ============================================================
// PHẦN 6/10: ANALYZE CẦU CƠ BẢN
// ============================================================
function analyzeCauBet(results, type) {
  if (results.length < 3) return { detected: false };
  let streakType = results[0], streakLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === streakType) streakLength++; else break;
  }
  if (streakLength >= 3) {
    const weight = getPatternWeight(type, 'cau_bet');
    let shouldBreak = false, confidence = 0, reason = '';
    if (streakLength <= CONFIG.STREAK_CONTINUE_THRESHOLD) {
      confidence = Math.round(Math.min(14, streakLength * 3.5) * weight);
      reason = `Bệt ${streakLength} - tiếp tục`;
    } else if (streakLength < CONFIG.STREAK_BREAK_MIN) {
      confidence = Math.round(Math.min(12, streakLength * 2.8) * weight);
      reason = `Bệt ${streakLength} - còn nhẹ`;
    } else if (streakLength < CONFIG.STREAK_BREAK_STRONG) {
      shouldBreak = true;
      confidence = Math.round(Math.min(15, streakLength * 2.5 + 2) * weight);
      reason = `Bệt ${streakLength} - bắt đầu bẻ`;
    } else {
      shouldBreak = true;
      confidence = Math.round(Math.min(18, streakLength * 2 + 4) * weight);
      reason = `Bệt ${streakLength} - bẻ mạnh`;
    }
    return {
      detected: true, type: streakType, length: streakLength,
      prediction: shouldBreak ? (streakType === 'Tài' ? 'Xỉu' : 'Tài') : streakType,
      confidence, name: `Cầu Bệt ${streakLength} phiên (${reason})`, patternId: 'cau_bet', priority: 10
    };
  }
  return { detected: false };
}

function analyzeCauDao11(results, type) {
  if (results.length < 4) return { detected: false };
  let len = 1;
  for (let i = 1; i < Math.min(results.length, 12); i++) {
    if (results[i] !== results[i - 1]) len++; else break;
  }
  if (len >= CONFIG.DAO11_MIN_LENGTH) {
    const weight = getPatternWeight(type, 'cau_dao_11');
    let prediction, confidence;
    if (len >= CONFIG.DAO11_BREAK_LENGTH) {
      prediction = results[0];
      confidence = Math.round(Math.min(13, 8 + (len - 5) * 1.5) * weight);
    } else {
      prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
      confidence = Math.round(Math.min(15, len * 2.5 + 4) * weight);
    }
    return {
      detected: true, length: len, prediction, confidence,
      name: `Cầu Đảo 1-1 (${len} phiên)`, patternId: 'cau_dao_11', priority: 9
    };
  }
  return { detected: false };
}

function analyzeCau22(results, type) {
  if (results.length < 6) return { detected: false };
  let count = 0, i = 0, pat = [];
  while (i < results.length - 1 && count < 5) {
    if (results[i] === results[i + 1]) { pat.push(results[i]); count++; i += 2; }
    else break;
  }
  if (count >= 2) {
    let alt = true;
    for (let j = 1; j < pat.length; j++) if (pat[j] === pat[j - 1]) { alt = false; break; }
    if (alt) {
      const last = pat[pat.length - 1];
      const w = getPatternWeight(type, 'cau_22');
      const willBreak = count >= 4;
      return {
        detected: true, pairCount: count,
        prediction: willBreak ? last : (last === 'Tài' ? 'Xỉu' : 'Tài'),
        confidence: Math.round(Math.min(14, count * 3 + 3) * w),
        name: `Cầu 2-2 (${count} cặp${willBreak ? ' - sắp gãy' : ''})`, patternId: 'cau_22', priority: 8
      };
    }
  }
  return { detected: false };
}

function analyzeCau33(results, type) {
  if (results.length < 6) return { detected: false };
  let count = 0, i = 0, pat = [];
  while (i < results.length - 2) {
    if (results[i] === results[i + 1] && results[i + 1] === results[i + 2]) {
      pat.push(results[i]); count++; i += 3;
    } else break;
  }
  if (count >= 1) {
    const pos = results.length % 3;
    const last = pat[pat.length - 1];
    const w = getPatternWeight(type, 'cau_33');
    return {
      detected: true, tripleCount: count,
      prediction: pos === 0 ? (last === 'Tài' ? 'Xỉu' : 'Tài') : last,
      confidence: Math.round(Math.min(13, count * 4 + 5) * w),
      name: `Cầu 3-3 (${count} bộ ba)`, patternId: 'cau_33', priority: 8
    };
  }
  return { detected: false };
}

function analyzeCau121(results, type) {
  if (results.length < 4) return { detected: false };
  const p = results.slice(0, 4);
  if (p[0] !== p[1] && p[1] === p[2] && p[2] !== p[3] && p[0] === p[3]) {
    const w = getPatternWeight(type, 'cau_121');
    return {
      detected: true, pattern: '1-2-1', prediction: p[0],
      confidence: Math.round(10 * w), name: 'Cầu 1-2-1', patternId: 'cau_121', priority: 7
    };
  }
  return { detected: false };
}

function analyzeCau123(results, type) {
  if (results.length < 6) return { detected: false };
  const first = results[5], nextTwo = results.slice(3, 5), lastThree = results.slice(0, 3);
  if (nextTwo[0] === nextTwo[1] && nextTwo[0] !== first) {
    const allSame = lastThree.every(r => r === lastThree[0]);
    if (allSame && lastThree[0] !== nextTwo[0]) {
      const w = getPatternWeight(type, 'cau_123');
      return {
        detected: true, pattern: '1-2-3', prediction: first,
        confidence: Math.round(11 * w), name: 'Cầu 1-2-3', patternId: 'cau_123', priority: 7
      };
    }
  }
  return { detected: false };
}

function analyzeCau321(results, type) {
  if (results.length < 6) return { detected: false };
  const first3 = results.slice(3, 6), next2 = results.slice(1, 3), last1 = results[0];
  const f3 = first3.every(r => r === first3[0]);
  const n2 = next2.every(r => r === next2[0]);
  if (f3 && n2 && first3[0] !== next2[0] && last1 !== next2[0]) {
    const w = getPatternWeight(type, 'cau_321');
    return {
      detected: true, pattern: '3-2-1', prediction: next2[0],
      confidence: Math.round(12 * w), name: 'Cầu 3-2-1', patternId: 'cau_321', priority: 7
    };
  }
  return { detected: false };
}
// ============================================================
// PHẦN 7/10: ANALYZE CẦU MỞ RỘNG
// ============================================================
function analyzeCauNhayCoc(results, type) {
  if (results.length < 6) return { detected: false };
  const skipPattern = [];
  for (let i = 0; i < Math.min(results.length, 12); i += 2) skipPattern.push(results[i]);
  if (skipPattern.length >= 3) {
    const w = getPatternWeight(type, 'cau_nhay_coc');
    const allSame = skipPattern.slice(0, 3).every(r => r === skipPattern[0]);
    if (allSame) return {
      detected: true, prediction: skipPattern[0], confidence: Math.round(8 * w),
      name: 'Cầu Nhảy Cóc', patternId: 'cau_nhay_coc', priority: 6
    };
    let alt = true;
    for (let i = 1; i < skipPattern.length - 1; i++) {
      if (skipPattern[i] === skipPattern[i - 1]) { alt = false; break; }
    }
    if (alt) return {
      detected: true, prediction: skipPattern[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(7 * w), name: 'Cầu Nhảy Cóc Đảo', patternId: 'cau_nhay_coc', priority: 6
    };
  }
  return { detected: false };
}

function analyzeCauNhipNghieng(results, type) {
  if (results.length < 5) return { detected: false };
  const last5 = results.slice(0, 5);
  const tai5 = last5.filter(r => r === 'Tài').length;
  const w = getPatternWeight(type, 'cau_nhip_nghieng');
  if (tai5 >= 4) return {
    detected: true, prediction: 'Tài', confidence: Math.round(9 * w),
    name: `Cầu Nhịp Nghiêng 5 (${tai5}/5 Tài)`, patternId: 'cau_nhip_nghieng', priority: 7
  };
  if (tai5 <= 1) return {
    detected: true, prediction: 'Xỉu', confidence: Math.round(9 * w),
    name: `Cầu Nhịp Nghiêng 5 (${5 - tai5}/5 Xỉu)`, patternId: 'cau_nhip_nghieng', priority: 7
  };
  return { detected: false };
}

function analyzeCau3Van1(results, type) {
  if (results.length < 4) return { detected: false };
  const last4 = results.slice(0, 4);
  const tai = last4.filter(r => r === 'Tài').length;
  const w = getPatternWeight(type, 'cau_3van1');
  if (tai === 3 && last4[3] === 'Xỉu') return {
    detected: true, prediction: 'Tài', confidence: Math.round(8 * w),
    name: 'Cầu 3 Ván 1 (3T-1X)', patternId: 'cau_3van1', priority: 6
  };
  if (tai === 1 && last4[3] === 'Tài') return {
    detected: true, prediction: 'Xỉu', confidence: Math.round(8 * w),
    name: 'Cầu 3 Ván 1 (3X-1T)', patternId: 'cau_3van1', priority: 6
  };
  return { detected: false };
}

function analyzeCauBeCau(results, type) {
  if (results.length < 5) return { detected: false };
  let len = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[0]) len++; else break;
  }
  if (len >= 4) {
    const w = getPatternWeight(type, 'cau_be_cau');
    return {
      detected: true, streakLength: len,
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(Math.min(14, len * 2 + 4) * w),
      name: `Cầu Bẻ Cầu (${len} phiên ${results[0]})`, patternId: 'cau_be_cau', priority: 8
    };
  }
  return { detected: false };
}

function analyzeCau44(results, type) {
  if (results.length < 8) return { detected: false };
  let count = 0, i = 0, pat = [];
  while (i < results.length - 3) {
    if (results[i] === results[i + 1] && results[i + 1] === results[i + 2] && results[i + 2] === results[i + 3]) {
      pat.push(results[i]); count++; i += 4;
    } else break;
  }
  if (count >= 1) {
    const pos = results.length - (count * 4);
    const last = pat[pat.length - 1];
    const w = getPatternWeight(type, 'cau_44');
    return {
      detected: true, quadCount: count,
      prediction: pos >= 3 ? (last === 'Tài' ? 'Xỉu' : 'Tài') : last,
      confidence: Math.round(Math.min(14, count * 4 + 6) * w),
      name: `Cầu 4-4 (${count} bộ bốn)`, patternId: 'cau_44', priority: 9
    };
  }
  return { detected: false };
}

function analyzeCau55(results, type) {
  if (results.length < 10) return { detected: false };
  let count = 0, i = 0, pat = [];
  while (i < results.length - 4) {
    if (results[i] === results[i + 1] && results[i + 1] === results[i + 2] &&
        results[i + 2] === results[i + 3] && results[i + 3] === results[i + 4]) {
      pat.push(results[i]); count++; i += 5;
    } else break;
  }
  if (count >= 1) {
    const pos = results.length - (count * 5);
    const last = pat[pat.length - 1];
    const w = getPatternWeight(type, 'cau_55');
    return {
      detected: true, quintCount: count,
      prediction: pos >= 4 ? (last === 'Tài' ? 'Xỉu' : 'Tài') : last,
      confidence: Math.round(Math.min(15, count * 5 + 7) * w),
      name: `Cầu 5-5 (${count} bộ năm)`, patternId: 'cau_55', priority: 9
    };
  }
  return { detected: false };
}

function analyzeCau212(results, type) {
  if (results.length < 5) return { detected: false };
  const p = results.slice(0, 5);
  const w = getPatternWeight(type, 'cau_212');
  if (p[0] === p[1] && p[1] !== p[2] && p[2] === p[3] && p[3] !== p[4] && p[0] !== p[2]) {
    return {
      detected: true, prediction: p[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(10 * w), name: 'Cầu 2-1-2', patternId: 'cau_212', priority: 8
    };
  }
  return { detected: false };
}

function analyzeCau1221(results, type) {
  if (results.length < 6) return { detected: false };
  const p = results.slice(0, 6);
  const w = getPatternWeight(type, 'cau_1221');
  if (p[0] !== p[1] && p[1] === p[2] && p[2] === p[3] && p[3] !== p[4] && p[4] === p[5]) {
    return {
      detected: true, prediction: p[0], confidence: Math.round(11 * w),
      name: 'Cầu 1-2-2-1', patternId: 'cau_1221', priority: 8
    };
  }
  return { detected: false };
}

function analyzeCau2112(results, type) {
  if (results.length < 6) return { detected: false };
  const p = results.slice(0, 6);
  const w = getPatternWeight(type, 'cau_2112');
  if (p[0] === p[1] && p[1] !== p[2] && p[2] === p[3] && p[3] !== p[4] && p[4] === p[5]) {
    return {
      detected: true, prediction: p[0], confidence: Math.round(11 * w),
      name: 'Cầu 2-1-1-2', patternId: 'cau_2112', priority: 8
    };
  }
  return { detected: false };
}

function analyzeCauGap(results, type) {
  if (results.length < 6) return { detected: false };
  const w = getPatternWeight(type, 'cau_gap');
  for (let gap = 2; gap <= 3; gap++) {
    let ok = true;
    const ref = results[0];
    for (let i = 0; i < Math.min(results.length, 12); i += (gap + 1)) {
      if (results[i] !== ref) { ok = false; break; }
    }
    if (ok) return {
      detected: true, gapSize: gap, prediction: ref,
      confidence: Math.round(9 * w), name: `Cầu Gấp ${gap + 1}`, patternId: 'cau_gap', priority: 7
    };
  }
  return { detected: false };
}

function analyzeCauZiczac(results, type) {
  if (results.length < 8) return { detected: false };
  const w = getPatternWeight(type, 'cau_ziczac');
  let count = 0;
  for (let i = 0; i < results.length - 2; i++) {
    if (results[i] !== results[i + 1] && results[i + 1] !== results[i + 2] && results[i] === results[i + 2]) count++;
    else break;
  }
  if (count >= 3) return {
    detected: true, zigzagCount: count,
    prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
    confidence: Math.round(Math.min(13, count * 2 + 5) * w),
    name: `Cầu Ziczac (${count})`, patternId: 'cau_ziczac', priority: 8
  };
  return { detected: false };
}

function analyzeCauDoi(results, type) {
  if (results.length < 4) return { detected: false };
  const w = getPatternWeight(type, 'cau_doi');
  let count = 0, i = 0;
  while (i < results.length - 1) {
    if (results[i] === results[i + 1]) { count++; i += 2; } else break;
  }
  if (count >= 2) {
    const isAlt = results[0] !== results[2];
    return {
      detected: true, pairChanges: count,
      prediction: isAlt ? (results[0] === 'Tài' ? 'Xỉu' : 'Tài') : results[0],
      confidence: Math.round(Math.min(12, count * 3 + 4) * w),
      name: `Cầu Đôi ${isAlt ? 'Đảo' : 'Bệt'} (${count} cặp)`, patternId: 'cau_doi', priority: 8
    };
  }
  return { detected: false };
}

function analyzeCauRong(results, type) {
  if (results.length < 6) return { detected: false };
  const w = getPatternWeight(type, 'cau_rong');
  let len = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[0]) len++; else break;
  }
  if (len >= 6) return {
    detected: true, streakLength: len,
    prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
    confidence: Math.round(Math.min(16, len + 8) * w),
    name: `Cầu Rồng ${len} phiên`, patternId: 'cau_rong', priority: 10
  };
  return { detected: false };
}

function analyzeSmartBet(results, type) {
  if (results.length < 10) return { detected: false };
  const w = getPatternWeight(type, 'smart_bet');
  const last10 = results.slice(0, 10), last5 = results.slice(0, 5), prev5 = results.slice(5, 10);
  const tai5 = last5.filter(r => r === 'Tài').length;
  const taiPrev5 = prev5.filter(r => r === 'Tài').length;
  if ((tai5 >= 4 && taiPrev5 <= 1) || (tai5 <= 1 && taiPrev5 >= 4)) {
    const cur = tai5 >= 4 ? 'Tài' : 'Xỉu';
    return {
      detected: true, prediction: cur === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(13 * w), name: 'Đảo Xu Hướng', patternId: 'smart_bet', priority: 9
    };
  }
  const tai10 = last10.filter(r => r === 'Tài').length;
  if (tai10 >= 8 || tai10 <= 2) {
    const dom = tai10 >= 8 ? 'Tài' : 'Xỉu';
    return {
      detected: true, prediction: dom === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(12 * w), name: `Xu Hướng Cực (${tai10}T-${10-tai10}X)`, patternId: 'smart_bet', priority: 9
    };
  }
  return { detected: false };
}

function analyzeDistribution(data, type, windowSize = 50) {
  const w = data.slice(0, windowSize);
  const tai = w.filter(d => d.Ket_qua === 'Tài').length;
  const xiu = w.length - tai;
  return {
    taiPercent: (tai / w.length) * 100,
    xiuPercent: (xiu / w.length) * 100,
    taiCount: tai, xiuCount: xiu,
    imbalance: Math.abs(tai - xiu) / w.length
  };
}

function analyzeDicePatterns(data) {
  const recent = data.slice(0, 15);
  let high = 0, low = 0, total = 0, sums = [];
  recent.forEach(d => {
    [d.xuc_xac_1, d.xuc_xac_2, d.xuc_xac_3].forEach(dice => { if (dice >= 4) high++; else low++; });
    total += d.tong; sums.push(d.tong);
  });
  const avg = total / recent.length;
  const variance = sums.reduce((a, v) => a + Math.pow(v - avg, 2), 0) / sums.length;
  return {
    highRatio: high / (high + low), lowRatio: low / (high + low),
    averageSum: avg, stdDev: Math.sqrt(variance), sumTrend: avg > 10.5 ? 'high' : 'low'
  };
}

function analyzeSumTrend(data) {
  const sums = data.slice(0, 20).map(d => d.tong);
  let inc = 0, dec = 0;
  for (let i = 0; i < sums.length - 1; i++) {
    if (sums[i] > sums[i + 1]) dec++;
    else if (sums[i] < sums[i + 1]) inc++;
  }
  const ma5 = sums.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  return {
    trend: inc > dec ? 'increasing' : 'decreasing',
    strength: Math.abs(inc - dec) / (sums.length - 1),
    movingAvg5: ma5, shortTermBias: ma5 > 10.5 ? 'Tài' : 'Xỉu'
  };
}

function analyzeEdgeCases(data, type) {
  if (data.length < 10) return { detected: false };
  const sums = data.slice(0, 10).map(d => d.tong);
  const high = sums.filter(t => t >= 14).length;
  const low = sums.filter(t => t <= 7).length;
  const w = getPatternWeight(type, 'edge_cases');
  if (high >= 4) return {
    detected: true, prediction: 'Xỉu', confidence: Math.round(7 * w),
    name: `Cực Điểm Cao (${high}/10)`, patternId: 'edge_cases', priority: 5
  };
  if (low >= 4) return {
    detected: true, prediction: 'Tài', confidence: Math.round(7 * w),
    name: `Cực Điểm Thấp (${low}/10)`, patternId: 'edge_cases', priority: 5
  };
  return { detected: false };
}

function analyzeDiceTrendLine(data, type) {
  if (data.length < 3) return { detected: false };
  const cur = data[0], prev = data[1];
  const c = [cur.xuc_xac_1, cur.xuc_xac_2, cur.xuc_xac_3];
  const p = [prev.xuc_xac_1, prev.xuc_xac_2, prev.xuc_xac_3];
  const dirs = [];
  for (let i = 0; i < 3; i++) {
    if (c[i] > p[i]) dirs.push('up');
    else if (c[i] < p[i]) dirs.push('down');
    else dirs.push('same');
  }
  const up = dirs.filter(d => d === 'up').length;
  const down = dirs.filter(d => d === 'down').length;
  const same = dirs.filter(d => d === 'same').length;
  const w = getPatternWeight(type, 'dice_trend_line');

  if (c[0] === c[1] && c[1] === c[2]) {
    const pred = c[0] >= 4 ? 'Xỉu' : 'Tài';
    return {
      detected: true, prediction: pred, confidence: Math.round(13 * w),
      name: `Biểu Đồ Đường (3 xúc xắc ${c[0]})`, patternId: 'dice_trend_line', priority: 11
    };
  }
  if (same === 2 && up === 1) return {
    detected: true, prediction: 'Xỉu', confidence: Math.round(14 * w),
    name: 'Dây Gãy (2 thẳng + 1 lên)', patternId: 'day_gay', priority: 13
  };
  if (same === 2 && down === 1) return {
    detected: true, prediction: 'Tài', confidence: Math.round(14 * w),
    name: 'Dây Gãy (2 thẳng + 1 xuống)', patternId: 'day_gay', priority: 13
  };
  if (up === 2 && down === 1) return {
    detected: true, prediction: 'Xỉu', confidence: Math.round(13 * w),
    name: 'Dây Gãy (2 lên 1 xuống)', patternId: 'day_gay', priority: 13
  };
  if (down === 2 && up === 1) return {
    detected: true, prediction: 'Tài', confidence: Math.round(13 * w),
    name: 'Dây Gãy (2 xuống 1 lên)', patternId: 'day_gay', priority: 13
  };
  return { detected: false };
}

function analyzeBreakPattern(results, data, type) {
  if (results.length < 5) return { detected: false };
  let len = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[0]) len++; else break;
  }
  const w = getPatternWeight(type, 'break_pattern');
  if (len >= 5) {
    const diff = Math.abs(data[0].tong - data[1].tong);
    if (diff >= 5) return {
      detected: true, prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(15 * w),
      name: `Liên Tục ${len} (biến động ${diff})`, patternId: 'break_pattern', priority: 12
    };
    if (len >= 7) return {
      detected: true, prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(16 * w),
      name: `Liên Tục ${len} (bẻ mạnh)`, patternId: 'break_pattern', priority: 12
    };
  }
  return { detected: false };
}

function analyzeDayGay(data, type) {
  if (data.length < 3) return { detected: false };
  const cur = data[0], prev = data[1];
  const c = [cur.xuc_xac_1, cur.xuc_xac_2, cur.xuc_xac_3];
  const p = [prev.xuc_xac_1, prev.xuc_xac_2, prev.xuc_xac_3];
  const dirs = [];
  for (let i = 0; i < 3; i++) {
    if (c[i] > p[i]) dirs.push('up');
    else if (c[i] < p[i]) dirs.push('down');
    else dirs.push('same');
  }
  const up = dirs.filter(d => d === 'up').length;
  const down = dirs.filter(d => d === 'down').length;
  const same = dirs.filter(d => d === 'same').length;
  const w = getPatternWeight(type, 'day_gay');

  if (same === 2 && up === 1) return {
    detected: true, prediction: 'Xỉu', confidence: Math.round(14 * w),
    name: 'Dây Gãy (2 same 1 up)', patternId: 'day_gay', priority: 13
  };
  if (same === 2 && down === 1) return {
    detected: true, prediction: 'Tài', confidence: Math.round(14 * w),
    name: 'Dây Gãy (2 same 1 down)', patternId: 'day_gay', priority: 13
  };
  return { detected: false };
}

function analyzeMarkovChain(results, type) {
  if (results.length < 20) return { detected: false };
  const t = { 'Tài->Tài': 0, 'Tài->Xỉu': 0, 'Xỉu->Tài': 0, 'Xỉu->Xỉu': 0 };
  for (let i = 0; i < results.length - 1; i++) {
    const key = `${results[i + 1]}->${results[i]}`;
    t[key]++;
  }
  const cur = results[0];
  let pred, prob;
  if (cur === 'Tài') {
    const total = t['Tài->Tài'] + t['Tài->Xỉu'];
    if (!total) return { detected: false };
    prob = t['Tài->Tài'] / total;
    pred = prob > CONFIG.MARKOV_WEAK_PROB ? 'Tài' : 'Xỉu';
  } else {
    const total = t['Xỉu->Tài'] + t['Xỉu->Xỉu'];
    if (!total) return { detected: false };
    prob = t['Xỉu->Xỉu'] / total;
    pred = prob > CONFIG.MARKOV_WEAK_PROB ? 'Xỉu' : 'Tài';
  }
  const w = getPatternWeight(type, 'markov_chain');
  if (Math.abs(prob - 0.5) > 0.08) return {
    detected: true, prediction: pred,
    confidence: Math.round(Math.min(15, Math.abs(prob - 0.5) * 35 + 8) * w),
    name: `Markov (${cur}→${pred}: ${(prob * 100).toFixed(0)}%)`,
    patternId: 'markov_chain', priority: 12
  };
  return { detected: false };
}

function analyzeMovingAvgDrift(data, type) {
  if (data.length < 20) return { detected: false };
  const sums = data.slice(0, 20).map(d => d.tong);
  const ma5 = sums.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  const ma10 = sums.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
  const ma20 = sums.reduce((a, b) => a + b, 0) / 20;
  const w = getPatternWeight(type, 'moving_avg_drift');
  const s = ma5 - ma10, l = ma10 - ma20, t = ma5 - ma20;
  if (Math.abs(s) > 1.2 && Math.abs(l) > 0.8 && s * l > 0) return {
    detected: true, prediction: s > 0 ? 'Xỉu' : 'Tài',
    confidence: Math.round(15 * w),
    name: `MA Drift Mạnh (${ma5.toFixed(1)}/${ma10.toFixed(1)}/${ma20.toFixed(1)})`,
    patternId: 'moving_avg_drift', priority: 11
  };
  if (Math.abs(t) > 2.5) return {
    detected: true, prediction: t > 0 ? 'Xỉu' : 'Tài',
    confidence: Math.round(13 * w),
    name: `MA Đảo Chiều (Drift:${t.toFixed(1)})`,
    patternId: 'moving_avg_drift', priority: 11
  };
  return { detected: false };
}

function analyzeSumPressure(data, type) {
  if (data.length < 15) return { detected: false };
  const sums = data.slice(0, 15).map(d => d.tong);
  const avg = sums.reduce((a, b) => a + b, 0) / sums.length;
  const dev = avg - CONFIG.SUM_MEAN;
  const high = sums.filter(s => s >= CONFIG.SUM_HIGH).length;
  const low = sums.filter(s => s <= CONFIG.SUM_LOW).length;
  const w = getPatternWeight(type, 'sum_pressure');

  if (Math.abs(dev) > 1.5) return {
    detected: true, prediction: dev > 0 ? 'Xỉu' : 'Tài',
    confidence: Math.round(Math.min(16, Math.abs(dev) * 5 + 7) * w),
    name: `Áp Lực Tổng ${dev > 0 ? 'CAO' : 'THẤP'} (Avg:${avg.toFixed(1)})`,
    patternId: 'sum_pressure', priority: 11
  };
  if (high >= 4) return {
    detected: true, prediction: 'Xỉu', confidence: Math.round(14 * w),
    name: `Cực Cao ×${high} (≥14)`, patternId: 'sum_pressure', priority: 11
  };
  if (low >= 4) return {
    detected: true, prediction: 'Tài', confidence: Math.round(14 * w),
    name: `Cực Thấp ×${low} (≤7)`, patternId: 'sum_pressure', priority: 11
  };
  return { detected: false };
}

function analyzeVolatility(data, type) {
  if (data.length < 10) return { detected: false };
  const sums = data.slice(0, 10).map(d => d.tong);
  const changes = [];
  for (let i = 0; i < sums.length - 1; i++) changes.push(Math.abs(sums[i] - sums[i + 1]));
  const avg = changes.reduce((a, b) => a + b, 0) / changes.length;
  const max = Math.max(...changes);
  const w = getPatternWeight(type, 'volatility');
  if (avg > 4 && max >= 7) return {
    detected: true, prediction: data[0].Ket_qua === 'Tài' ? 'Xỉu' : 'Tài',
    confidence: Math.round(12 * w),
    name: `Biến Động Cao (Avg:${avg.toFixed(1)})`,
    patternId: 'volatility', priority: 10
  };
  return { detected: false };
}

function analyzeSunHotCold(results, type) {
  if (results.length < 10) return { detected: false };
  const last10 = results.slice(0, 10);
  const tai10 = last10.filter(r => r === 'Tài').length;
  const w = getPatternWeight(type, 'sun_hot_cold');
  if (tai10 >= 7) return {
    detected: true, prediction: tai10 >= 8 ? 'Xỉu' : 'Tài',
    confidence: Math.round((tai10 >= 8 ? 14 : 12) * w * (tai10 / 10)),
    name: `Sun Nóng Tài (${tai10}/10)`, patternId: 'sun_hot_cold', priority: 13
  };
  if (tai10 <= 3) {
    const xiu10 = 10 - tai10;
    return {
      detected: true, prediction: xiu10 >= 8 ? 'Tài' : 'Xỉu',
      confidence: Math.round((xiu10 >= 8 ? 14 : 12) * w * (xiu10 / 10)),
      name: `Sun Nóng Xỉu (${xiu10}/10)`, patternId: 'sun_hot_cold', priority: 13
    };
  }
  return { detected: false };
}

function analyzeSunStreakBreak(results, last50, type) {
  if (results.length < 4) return { detected: false };
  let streak = 1;
  const curType = results[0];
  for (let i = 1; i < results.length; i++) {
    if (results[i] === curType) streak++; else break;
  }
  const w = getPatternWeight(type, 'sun_streak_break');
  if (streak >= 3) {
    const sums = last50.slice(0, streak).map(d => d.tong || 0).filter(s => s > 0);
    const avgSum = sums.length > 0 ? sums.reduce((a, b) => a + b, 0) / sums.length : CONFIG.SUM_MEAN;
    let shouldBreak = false, conf = 0, reason = '';
    if (streak === 3) { conf = 13; reason = 'tiếp tục (62%)'; }
    else if (streak === 4) { conf = 12; reason = 'tiếp tục nhẹ (55%)'; }
    else if (streak === 5) { shouldBreak = true; conf = 14; reason = 'bắt đầu bẻ (58%)'; }
    else if (streak === 6) { shouldBreak = true; conf = 16; reason = 'bẻ mạnh (65%)'; }
    else { shouldBreak = true; conf = Math.min(20, 16 + (streak - 7)); reason = `bẻ rất mạnh (72%)`; }
    if (curType === 'Tài' && avgSum <= 9.5) { shouldBreak = true; conf = Math.min(20, conf + 2); reason += ' + sum thấp'; }
    if (curType === 'Xỉu' && avgSum >= 12) { shouldBreak = true; conf = Math.min(20, conf + 2); reason += ' + sum cao'; }
    return {
      detected: true, streakLength: streak, streakType: curType,
      prediction: shouldBreak ? (curType === 'Tài' ? 'Xỉu' : 'Tài') : curType,
      confidence: Math.round(conf * w),
      name: `Sun Streak ${streak} ${curType} (${reason})`,
      patternId: 'sun_streak_break', priority: 14
    };
  }
  return { detected: false };
}

function analyzeSunBalance(results, type) {
  if (results.length < 15) return { detected: false };
  const last15 = results.slice(0, 15);
  const tai = last15.filter(r => r === 'Tài').length;
  const xiu = 15 - tai;
  const diff = Math.abs(tai - xiu);
  const w = getPatternWeight(type, 'sun_balance');
  if (diff >= 7) return {
    detected: true, prediction: tai < xiu ? 'Tài' : 'Xỉu',
    confidence: Math.round(Math.min(13, diff + 5) * w),
    name: `Sun Cân Bằng (T:${tai} X:${xiu})`, patternId: 'sun_balance', priority: 12
  };
  return { detected: false };
}

function analyzeSunMomentumShift(results, type) {
  if (results.length < 12) return { detected: false };
  const recent6 = results.slice(0, 6);
  const prev6 = results.slice(6, 12);
  const rTai = recent6.filter(r => r === 'Tài').length;
  const pTai = prev6.filter(r => r === 'Tài').length;
  const shift = rTai - pTai;
  if (Math.abs(shift) >= 4) {
    const w = getPatternWeight(type, 'sun_momentum_shift');
    return {
      detected: true, prediction: shift > 0 ? 'Tài' : 'Xỉu',
      confidence: Math.round(Math.min(14, Math.abs(shift) * 2 + 4) * w),
      name: `Sun Đổi Chiều → ${shift > 0 ? 'Tài' : 'Xỉu'}`,
      patternId: 'sun_momentum_shift', priority: 13
    };
  }
  return { detected: false };
}
// ============================================================
// PHẦN 8/10: CALCULATE ADVANCED PREDICTION
// ============================================================
function buildPatternString(data, len = 18) {
  const arr = data.slice(0, Math.min(len, data.length)).map(d => {
    const kq = String(d.Ket_qua || d.ket_qua || '').toLowerCase();
    return kq.includes('tài') ? 't' : 'x';
  });
  return arr.join('') || 'xxxxxxxxxx';
}

function getMainCauName(allPatterns = []) {
  if (!allPatterns || allPatterns.length === 0) return 'Cầu Tự Nhiên';
  const sorted = [...allPatterns].sort((a, b) =>
    (b.priority || 0) - (a.priority || 0) || (b.confidence || 0) - (a.confidence || 0)
  );
  return sorted[0].name || 'Cầu Tự Nhiên';
}

function calculateAdvancedPrediction(data, type) {
  const last50 = data.slice(0, 50);
  const results = last50.map(d => d.Ket_qua);

  initializePatternStats(type);
  const predictions = [];
  const factors = [];
  const allPatterns = [];

  const analyzers = [
    analyzeCauBet, analyzeCauDao11, analyzeCau22, analyzeCau33,
    analyzeCau121, analyzeCau123, analyzeCau321,
    analyzeCauNhayCoc, analyzeCauNhipNghieng, analyzeCau3Van1, analyzeCauBeCau,
    analyzeCau44, analyzeCau55, analyzeCau212, analyzeCau1221, analyzeCau2112,
    analyzeCauGap, analyzeCauZiczac, analyzeCauDoi, analyzeCauRong, analyzeSmartBet
  ];
  for (const fn of analyzers) {
    try {
      const r = fn(results, type);
      if (r && r.detected) {
        predictions.push({ prediction: r.prediction, confidence: r.confidence, priority: r.priority || 5, name: r.name });
        factors.push(r.name);
        allPatterns.push(r);
      }
    } catch (e) {}
  }

  try { const r = analyzeDiceTrendLine(last50, type); if (r.detected) { predictions.push({ prediction: r.prediction, confidence: r.confidence, priority: r.priority || 11, name: r.name }); factors.push(r.name); allPatterns.push(r); } } catch (e) {}
  try { const r = analyzeBreakPattern(results, last50, type); if (r.detected) { predictions.push({ prediction: r.prediction, confidence: r.confidence, priority: r.priority || 12, name: r.name }); factors.push(r.name); allPatterns.push(r); } } catch (e) {}
  try { const r = analyzeDayGay(last50, type); if (r.detected) { predictions.push({ prediction: r.prediction, confidence: r.confidence, priority: r.priority || 13, name: r.name }); factors.push(r.name); allPatterns.push(r); } } catch (e) {}
  try { const r = analyzeMarkovChain(results, type); if (r.detected) { predictions.push({ prediction: r.prediction, confidence: r.confidence, priority: r.priority || 12, name: r.name }); factors.push(r.name); allPatterns.push(r); } } catch (e) {}
  try { const r = analyzeMovingAvgDrift(last50, type); if (r.detected) { predictions.push({ prediction: r.prediction, confidence: r.confidence, priority: r.priority || 11, name: r.name }); factors.push(r.name); allPatterns.push(r); } } catch (e) {}
  try { const r = analyzeSumPressure(last50, type); if (r.detected) { predictions.push({ prediction: r.prediction, confidence: r.confidence, priority: r.priority || 11, name: r.name }); factors.push(r.name); allPatterns.push(r); } } catch (e) {}
  try { const r = analyzeVolatility(last50, type); if (r.detected) { predictions.push({ prediction: r.prediction, confidence: r.confidence, priority: r.priority || 10, name: r.name }); factors.push(r.name); allPatterns.push(r); } } catch (e) {}
  try { const r = analyzeEdgeCases(last50, type); if (r.detected) { predictions.push({ prediction: r.prediction, confidence: r.confidence, priority: r.priority || 5, name: r.name }); factors.push(r.name); allPatterns.push(r); } } catch (e) {}
  try { const r = analyzeSunHotCold(results, type); if (r.detected) { predictions.push({ prediction: r.prediction, confidence: r.confidence, priority: r.priority || 13, name: r.name }); factors.push(r.name); allPatterns.push(r); } } catch (e) {}
  try { const r = analyzeSunStreakBreak(results, last50, type); if (r.detected) { predictions.push({ prediction: r.prediction, confidence: r.confidence, priority: r.priority || 14, name: r.name }); factors.push(r.name); allPatterns.push(r); } } catch (e) {}
  try { const r = analyzeSunBalance(results, type); if (r.detected) { predictions.push({ prediction: r.prediction, confidence: r.confidence, priority: r.priority || 12, name: r.name }); factors.push(r.name); allPatterns.push(r); } } catch (e) {}
  try { const r = analyzeSunMomentumShift(results, type); if (r.detected) { predictions.push({ prediction: r.prediction, confidence: r.confidence, priority: r.priority || 13, name: r.name }); factors.push(r.name); allPatterns.push(r); } } catch (e) {}

  try {
    const dist = analyzeDistribution(last50, type);
    if (dist.imbalance > 0.2) {
      const minority = dist.taiPercent < 50 ? 'Tài' : 'Xỉu';
      const w = getPatternWeight(type, 'distribution');
      predictions.push({ prediction: minority, confidence: Math.round(6 * w), priority: 5, name: 'Phân bố lệch' });
      factors.push(`Phân bố lệch (T:${dist.taiPercent.toFixed(0)}% - X:${dist.xiuPercent.toFixed(0)}%)`);
    }
  } catch (e) {}

  try {
    const dp = analyzeDicePatterns(last50);
    if (dp.averageSum > 11.5) {
      const w = getPatternWeight(type, 'dice_pattern');
      predictions.push({ prediction: 'Xỉu', confidence: Math.round(5 * w), priority: 4, name: 'Tổng TB cao' });
      factors.push(`Tổng TB cao (${dp.averageSum.toFixed(1)})`);
    } else if (dp.averageSum < 9.5) {
      const w = getPatternWeight(type, 'dice_pattern');
      predictions.push({ prediction: 'Tài', confidence: Math.round(5 * w), priority: 4, name: 'Tổng TB thấp' });
      factors.push(`Tổng TB thấp (${dp.averageSum.toFixed(1)})`);
    }
  } catch (e) {}

  try {
    const st = analyzeSumTrend(last50);
    if (st.strength > 0.4) {
      const pred = st.trend === 'increasing' ? 'Tài' : 'Xỉu';
      const w = getPatternWeight(type, 'sum_trend');
      predictions.push({ prediction: pred, confidence: Math.round(4 * w), priority: 3, name: 'Xu hướng tổng' });
      factors.push(`Xu hướng tổng ${st.trend === 'increasing' ? 'tăng' : 'giảm'}`);
    }
  } catch (e) {}

  if (predictions.length === 0) {
    const tai10 = results.slice(0, 10).filter(r => r === 'Tài').length;
    const pred = tai10 > 5 ? 'Tài' : 'Xỉu';
    predictions.push({ prediction: pred, confidence: 5, priority: 1, name: 'Cầu Tự Nhiên' });
    factors.push('Cầu Tự Nhiên');
  }

  predictions.sort((a, b) => b.priority - a.priority || b.confidence - a.confidence);

  const taiVotes = predictions.filter(p => p.prediction === 'Tài');
  const xiuVotes = predictions.filter(p => p.prediction === 'Xỉu');
  const taiScore = taiVotes.reduce((s, p) => s + p.confidence * Math.pow(p.priority, 1.2), 0);
  const xiuScore = xiuVotes.reduce((s, p) => s + p.confidence * Math.pow(p.priority, 1.2), 0);

  let finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
  finalPrediction = getSmartPredictionAdjustment(type, finalPrediction, allPatterns);

  let baseConfidence = 52;
  predictions.slice(0, 3).forEach((p, i) => {
    if (p.prediction === finalPrediction) baseConfidence += Math.round(p.confidence * (1 - i * 0.15));
  });
  const agree = finalPrediction === 'Tài' ? taiVotes.length : xiuVotes.length;
  baseConfidence += Math.round((agree / predictions.length) * 12);
  baseConfidence += getAdaptiveConfidenceBoost(type);
  const randomAdj = (Math.random() * 2.5) - 1.25;
  let finalConfidence = Math.round(baseConfidence + randomAdj);
  finalConfidence = Math.max(CONFIG.MIN_CONFIDENCE, Math.min(CONFIG.MAX_CONFIDENCE, finalConfidence));

  const rv = applyAutoReversal(type, finalPrediction);
  const output = rv.prediction;
  if (rv.reversed) factors.unshift(`🔄 Auto-Reversal (${rv.originalPrediction} → ${output})`);

  return {
    prediction: output,
    confidence: finalConfidence,
    factors,
    allPatterns,
    reversed: rv.reversed,
    originalPrediction: rv.originalPrediction || null
  };
}

function savePredictionToHistory(type, phien, prediction, confidence) {
  const record = {
    phien_hien_tai: phien.toString(),
    du_doan: normalizeResult(prediction),
    ti_le: `${confidence}%`,
    id: ADMIN,
    timestamp: new Date().toISOString()
  };
  predictionHistory[type].unshift(record);
  if (predictionHistory[type].length > MAX_HISTORY) {
    predictionHistory[type] = predictionHistory[type].slice(0, MAX_HISTORY);
  }
  return record;
}
// ============================================================
// PHẦN 9/10: API ROUTES
// ============================================================
function scoreText(conf) {
  if (conf >= 80) return 'Rất';
  if (conf >= 70) return 'Mạnh';
  if (conf >= 60) return 'Khá';
  return 'Thấp';
}

// GET /api/sunwin/dudoan - Dự đoán phiên tiếp theo (9 field)
app.get('/api/sunwin/dudoan', async (req, res) => {
  try {
    const data = await fetchData();
    if (!data || !data.data || data.data.length === 0) {
      return res.status(500).json({ success: false, admin: ADMIN, error: 'Không thể lấy dữ liệu' });
    }

    setTimeout(() => { verifyPredictions('b52', data.data).catch(() => {}); }, 0);

    const prev = data.data[0];
    const prevPhien = Number(prev.Phien);
    const nextPhien = prevPhien + 1;

    const result = calculateAdvancedPrediction(data.data, 'b52');

    setTimeout(() => {
      savePredictionToHistory('b52', nextPhien, result.prediction, result.confidence);
      recordPrediction('b52', nextPhien, result.prediction, result.confidence, result.factors);
    }, 0);

    const dice = [prev.xuc_xac_1 ?? 0, prev.xuc_xac_2 ?? 0, prev.xuc_xac_3 ?? 0];
    const tong = prev.tong ?? (dice[0] + dice[1] + dice[2]);
    const ketQua = prev.Ket_qua || (tong >= 11 ? 'Tài' : 'Xỉu');

    res.json({
      success: true,
      admin: ADMIN,
      phien_truoc: prevPhien,
      xuc_xac: dice,
      tong: tong,
      ket_qua: ketQua,
      phien_hien_tai: nextPhien,
      du_doan: result.prediction,
      do_tin_cay: `${result.confidence}%`
    });
  } catch (e) {
    console.error('[dudoan] Error:', e.message);
    res.status(500).json({ success: false, admin: ADMIN, error: 'Lỗi server: ' + e.message });
  }
});

// GET /api/sunwin/history - Lịch sử dự đoán đúng/sai
app.get('/api/sunwin/history', async (req, res) => {
  try {
    try {
      const data = await fetchData();
      if (data && data.data && data.data.length > 0) {
        await verifyPredictions('b52', data.data);
      }
    } catch (vErr) {
      console.warn('[history] verify failed:', vErr.message);
    }

    if (!predictionHistory.b52) predictionHistory.b52 = [];

    const predMap = new Map();
    (learningData.b52.predictions || []).forEach(p => predMap.set(p.phien, p));

    const dataMap = new Map();
    try {
      const d = await fetchData();
      (d.data || []).forEach(item => dataMap.set(String(item.Phien), item));
    } catch (e) {}

    const list = predictionHistory.b52.map(rec => {
      const pred = predMap.get(rec.phien_hien_tai);
      const real = dataMap.get(rec.phien_hien_tai);
      let status = null, isCorrect = null;
      if (pred && pred.verified) {
        status = pred.isCorrect ? '✅' : '❌';
        isCorrect = pred.isCorrect;
      }
      const duDoanText = rec.du_doan === 'tai' ? 'Tài' : (rec.du_doan === 'xiu' ? 'Xỉu' : rec.du_doan);
      return {
        phien: rec.phien_hien_tai,
        du_doan: rec.du_doan,
        du_doan_text: duDoanText,
        ti_le: rec.ti_le,
        timestamp: rec.timestamp,
        ket_qua_thuc_te: real ? real.Ket_qua : (pred ? pred.actual : null),
        xuc_xac: real ? [real.xuc_xac_1, real.xuc_xac_2, real.xuc_xac_3] : null,
        tong: real ? real.tong : null,
        status: status,
        is_correct: isCorrect
      };
    });

    const verified = list.filter(h => h.status !== null).length;
    const correct = list.filter(h => h.status === '✅').length;
    const wrong = list.filter(h => h.status === '❌').length;
    const accuracy = verified > 0 ? ((correct / verified) * 100).toFixed(2) + '%' : 'N/A';

    res.json({
      success: true,
      admin: ADMIN,
      summary: {
        total: list.length,
        verified: verified,
        correct: correct,
        wrong: wrong,
        accuracy: accuracy,
        last_update: learningData.b52.lastUpdate
      },
      history: list
    });
  } catch (e) {
    console.error('[history] Error:', e.message);
    res.status(500).json({ success: false, admin: ADMIN, error: e.message, history: [] });
  }
});

// GET /api/sunwin/stats - Thống kê learning
app.get('/api/sunwin/stats', (req, res) => {
  try {
    const rv = learningData.b52.reversalState || {};
    const patternStats = [];
    Object.keys(learningData.b52.patternStats || {}).forEach(id => {
      const s = learningData.b52.patternStats[id];
      if (s && s.total > 0) {
        patternStats.push({
          id: id,
          total: s.total,
          correct: s.correct,
          accuracy: (s.accuracy * 100).toFixed(1) + '%',
          weight: learningData.b52.patternWeights[id] || 1.0
        });
      }
    });
    patternStats.sort((a, b) => parseFloat(b.accuracy) - parseFloat(a.accuracy));

    res.json({
      success: true,
      admin: ADMIN,
      stats: {
        total_predictions: learningData.b52.totalPredictions,
        correct_predictions: learningData.b52.correctPredictions,
        accuracy: learningData.b52.totalPredictions > 0
          ? ((learningData.b52.correctPredictions / learningData.b52.totalPredictions) * 100).toFixed(2) + '%'
          : 'N/A',
        current_streak: learningData.b52.streakAnalysis.currentStreak,
        best_streak: learningData.b52.streakAnalysis.bestStreak,
        worst_streak: learningData.b52.streakAnalysis.worstStreak,
        wins: learningData.b52.streakAnalysis.wins,
        losses: learningData.b52.streakAnalysis.losses,
        auto_reversal: {
          active: rv.active || false,
          activated_at: rv.activatedAt || null,
          total_reversals: rv.reversalCount || 0,
          consecutive_losses: rv.consecutiveLosses || 0,
          threshold: CONFIG.REVERSAL_THRESHOLD
        },
        top_patterns: patternStats.slice(0, 10),
        last_update: learningData.b52.lastUpdate
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, admin: ADMIN, error: e.message });
  }
});

// GET /api/sunwin/health - Health check
app.get('/api/sunwin/health', (req, res) => {
  res.json({
    success: true,
    service: 'Sun Prediction API',
    version: VERSION,
    admin: ADMIN,
    uptime_seconds: Math.floor((Date.now() - START_TIME) / 1000),
    timestamp: new Date().toISOString(),
    endpoints: {
      dashboard: '/',
      predict: '/api/sunwin/dudoan',
      history: '/api/sunwin/history',
      stats: '/api/sunwin/stats',
      health: '/api/sunwin/health'
    }
  });
});
// ============================================================
// PHẦN 10/10: DASHBOARD ROUTE + START SERVER
// ============================================================

// GET / - Serve Dashboard HTML
app.get('/', (req, res) => {
  try {
    const dashPath = path.join(__dirname, DASHBOARD_FILE);
    if (fs.existsSync(dashPath)) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.sendFile(dashPath);
    }
    // Fallback nếu chưa có file dashboard.html
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Sun API</title>
    <style>body{background:#0f172a;color:#e2e8f0;font-family:system-ui;padding:20px}
    a{color:#38bdf8;text-decoration:none;display:block;padding:10px;border:1px solid #334155;border-radius:8px;margin:8px 0}
    a:hover{background:#1e293b}h1{color:#38bdf8}</style></head>
    <body><h1>🌞 Sun Prediction API v${VERSION}</h1>
    <p>Admin: <b>${ADMIN}</b></p>
    <h2>Endpoints</h2>
    <a href="/api/sunwin/dudoan">📊 /api/sunwin/dudoan — Dự đoán</a>
    <a href="/api/sunwin/history">📜 /api/sunwin/history — Lịch sử</a>
    <a href="/api/sunwin/stats">📈 /api/sunwin/stats — Thống kê</a>
    <a href="/api/sunwin/health">💓 /api/sunwin/health — Health</a>
    <p style="margin-top:30px;color:#64748b;font-size:12px">
    Chưa có file <code>dashboard.html</code> trong cùng thư mục. Tạo file đó để hiển thị dashboard đầy đủ.
    </p></body></html>`);
  } catch (e) {
    res.status(500).send('Dashboard error: ' + e.message);
  }
});

// 404 fallback
app.use((req, res) => {
  res.status(404).json({
    success: false,
    admin: ADMIN,
    error: 'Endpoint không tồn tại',
    path: req.path,
    available: ['/', '/api/sunwin/dudoan', '/api/sunwin/history', '/api/sunwin/stats', '/api/sunwin/health']
  });
});

// ============================================================
// START
// ============================================================
loadLearningData();
loadPredictionHistory();

app.listen(PORT, '0.0.0.0', () => {
  console.log('════════════════════════════════════════════');
  console.log(`🌞 Sun Prediction API v${VERSION} - Port ${PORT}`);
  console.log('════════════════════════════════════════════');
  console.log('Endpoints:');
  console.log(`  GET /                    → Dashboard HTML`);
  console.log(`  GET /api/sunwin/dudoan   → Dự đoán JSON`);
  console.log(`  GET /api/sunwin/history  → Lịch sử JSON`);
  console.log(`  GET /api/sunwin/stats    → Thống kê JSON`);
  console.log(`  GET /api/sunwin/health   → Health JSON`);
  console.log('════════════════════════════════════════════');
  startAutoSaveTask();
});