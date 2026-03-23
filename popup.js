(() => {
  'use strict';

  const ENDPOINTS = {
    ping: 'https://www.gstatic.com/generate_204',
    download: [
      'https://speed.cloudflare.com/__down?bytes=1500000',
      'https://speed.cloudflare.com/__down?bytes=3500000',
      'https://speed.cloudflare.com/__down?bytes=7000000',
    ],
    upload: 'https://speed.cloudflare.com/__up',
  };

  const STORAGE_KEY = 'speedmate_history';
  const TEST_DURATION_MS = 5000;
  const MAX_DIAL_MBPS = 500;

  const ui = {
    startBtn: document.getElementById('start-btn'),
    historyBtn: document.getElementById('history-btn'),
    statusText: document.getElementById('status-text'),
    downloadSpeed: document.getElementById('download-speed'),
    downMetric: document.getElementById('down-metric'),
    upMetric: document.getElementById('up-metric'),
    pingMetric: document.getElementById('ping-metric'),
    qualityCard: document.getElementById('quality-card'),
    qualityTitle: document.getElementById('quality-title'),
    qualityCopy: document.getElementById('quality-copy'),
    testTimer: document.getElementById('test-timer'),
    dial: document.querySelector('.dial'),
    inlineAdSlot: document.getElementById('inline-ad-slot'),
    footerAdSlot: document.getElementById('footer-ad-slot'),
  };

  let latestResult = null;

  function toMbps(bytes, ms) {
    if (!bytes || ms <= 0) return 0;
    return ((bytes * 8) / (ms / 1000)) / 1000000;
  }

  function average(values) {
    const valid = values.filter((v) => Number.isFinite(v) && v >= 0);
    if (!valid.length) return 0;
    return valid.reduce((a, b) => a + b, 0) / valid.length;
  }

  function setStatus(text) {
    ui.statusText.textContent = text;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function speedToAngle(speedMbps) {
    const capped = clamp(speedMbps, 0, MAX_DIAL_MBPS);
    const ratio = capped / MAX_DIAL_MBPS;
    return -90 + ratio * 180;
  }

  function setNeedleSpeed(speedMbps) {
    const angle = speedToAngle(speedMbps);
    ui.dial.style.setProperty('--needle-angle', `${angle}deg`);
  }

  function updateMetrics({ down = 0, up = 0, ping = 0 }) {
    ui.downloadSpeed.textContent = down.toFixed(2);
    ui.downMetric.textContent = down.toFixed(2);
    ui.upMetric.textContent = up.toFixed(2);
    ui.pingMetric.textContent = Math.round(ping).toString();
    setNeedleSpeed(down);
  }

  function scoreQuality({ down, up, ping }) {
    if (!navigator.onLine) {
      return {
        level: 'bad',
        title: 'Offline',
        copy: 'No internet connection detected. Reconnect and run the test again.',
      };
    }

    const great = down >= 50 && up >= 15 && ping <= 40;
    if (great) {
      return {
        level: 'good',
        title: 'Excellent Connection',
        copy: 'Great for 4K streaming, gaming, large uploads, and video calls.',
      };
    }

    const decent = down >= 20 && up >= 5 && ping <= 100;
    if (decent) {
      return {
        level: 'warn',
        title: 'Good for Most Tasks',
        copy: 'Fine for HD streaming and meetings, but heavy uploads may be slower.',
      };
    }

    return {
      level: 'bad',
      title: 'Spotty Connection',
      copy: 'Higher delay or lower speeds may cause buffering, lag, or call quality drops.',
    };
  }

  function renderQuality(result) {
    const score = scoreQuality(result);
    ui.qualityCard.classList.remove('good', 'warn', 'bad');
    ui.qualityCard.classList.add(score.level);
    ui.qualityTitle.textContent = score.title;
    ui.qualityCopy.textContent = score.copy;
  }

  function setAdsUnlocked(unlocked) {
    ui.inlineAdSlot.classList.toggle('ad-slot--locked', !unlocked);
    ui.footerAdSlot.classList.toggle('ad-slot--locked', !unlocked);
  }

  async function timedFetch(url, options = {}) {
    const start = performance.now();
    await fetch(url, {
      cache: 'no-store',
      mode: 'no-cors',
      ...options,
    });
    return performance.now() - start;
  }

  async function measurePing(samples = 3) {
    const results = [];
    for (let i = 0; i < samples; i += 1) {
      try {
        const ms = await timedFetch(`${ENDPOINTS.ping}?t=${Date.now()}-${i}`);
        results.push(ms);
      } catch {
        // Ignore single failures and continue sampling.
      }
    }
    return average(results);
  }

  async function measureDownload() {
    const sampleResults = [];

    for (let i = 0; i < ENDPOINTS.download.length; i += 1) {
      const url = ENDPOINTS.download[i];
      const byteMatch = url.match(/bytes=(\d+)/i);
      const bytes = Number(byteMatch?.[1] || 0);

      try {
        const ms = await timedFetch(`${url}&cacheBust=${Date.now()}-${i}`);
        sampleResults.push(toMbps(bytes, ms));
      } catch {
        // Keep going so partial results are still useful.
      }

      setStatus(`Measuring download speed (${i + 1}/${ENDPOINTS.download.length})...`);
    }

    return average(sampleResults);
  }

  async function measureUpload() {
    const payloadSize = 1000000;
    const payload = new Uint8Array(payloadSize);

    const sampleResults = [];
    for (let i = 0; i < 2; i += 1) {
      const body = new Blob([payload], { type: 'text/plain' });

      try {
        const ms = await timedFetch(`${ENDPOINTS.upload}?cacheBust=${Date.now()}-${i}`, {
          method: 'POST',
          body,
        });
        sampleResults.push(toMbps(payloadSize, ms));
      } catch {
        // Keep best effort behavior.
      }

      setStatus(`Measuring upload speed (${i + 1}/2)...`);
    }

    return average(sampleResults);
  }

  function setTestingState(inProgress) {
    ui.startBtn.disabled = inProgress;
    ui.historyBtn.disabled = inProgress;
    ui.startBtn.textContent = inProgress ? 'Testing...' : 'Run Speed Test';
  }

  function nowIso() {
    return new Date().toISOString();
  }

  async function loadHistory() {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
  }

  async function saveResult() {
    if (!latestResult) {
      setStatus('Run a test first, then save the result.');
      return;
    }

    const existing = await loadHistory();
    const next = [
      {
        ...latestResult,
        savedAt: nowIso(),
      },
      ...existing,
    ].slice(0, 25);

    await chrome.storage.local.set({ [STORAGE_KEY]: next });
    setStatus('Result saved to local history.');
  }

  async function runSpeedTest() {
    setTestingState(true);

    try {
      if (!navigator.onLine) {
        updateMetrics({ down: 0, up: 0, ping: 0 });
        renderQuality({ down: 0, up: 0, ping: 9999 });
        setStatus('You appear offline. Reconnect and try again.');
        ui.testTimer.textContent = '5s timed test';
        return;
      }

      let measuredResult = null;
      let measuredError = false;
      let displaySpeed = 0;

      ui.testTimer.textContent = '5s timed test in progress';
      setStatus('Measuring latency...');

      const measurementPromise = (async () => {
        const ping = await measurePing(4);
        setStatus('Measuring download speed...');
        const down = await measureDownload();
        setStatus('Measuring upload speed...');
        const up = await measureUpload();
        return {
          down: Number(down.toFixed(2)),
          up: Number(up.toFixed(2)),
          ping: Math.round(ping),
          testedAt: nowIso(),
        };
      })();

      measurementPromise
        .then((result) => {
          measuredResult = result;
        })
        .catch(() => {
          measuredError = true;
        });

      const animationStart = performance.now();
      await new Promise((resolve) => {
        const tick = () => {
          const elapsed = performance.now() - animationStart;
          const progress = clamp(elapsed / TEST_DURATION_MS, 0, 1);
          const remainingSeconds = Math.max(0, Math.ceil((TEST_DURATION_MS - elapsed) / 1000));

          if (measuredResult) {
            setStatus('Finalizing result...');
          }

          const fallbackTarget =
            10 + Math.abs(Math.sin(progress * 13)) * 90 + Math.abs(Math.cos(progress * 4.5)) * 45;
          const measuredTarget = measuredResult ? measuredResult.down : fallbackTarget;
          const weightedTarget = measuredResult
            ? measuredTarget * (0.45 + progress * 0.55)
            : fallbackTarget;

          displaySpeed += (weightedTarget - displaySpeed) * 0.14;
          setNeedleSpeed(displaySpeed);
          ui.downloadSpeed.textContent = displaySpeed.toFixed(2);
          ui.testTimer.textContent = `Final speed in ${remainingSeconds}s`;

          if (progress >= 1) {
            resolve();
            return;
          }

          requestAnimationFrame(tick);
        };

        requestAnimationFrame(tick);
      });

      let finalResult = null;
      try {
        finalResult = await measurementPromise;
      } catch {
        measuredError = true;
      }

      if (measuredError || !finalResult) {
        setStatus('Speed test failed. Check connection and try again.');
        ui.testTimer.textContent = '5s timed test';
        setAdsUnlocked(false);
        return;
      }

      latestResult = finalResult;
      updateMetrics(latestResult);
      ui.testTimer.textContent = '5s timed test complete';
      renderQuality(latestResult);
      setStatus('Test complete. Final speed locked.');
      setAdsUnlocked(true);
    } catch {
      setStatus('Speed test failed. Check connection and try again.');
      ui.testTimer.textContent = '5s timed test';
      setAdsUnlocked(false);
    } finally {
      setTestingState(false);
    }
  }

  function wireEvents() {
    ui.startBtn.addEventListener('click', runSpeedTest);
    ui.historyBtn.addEventListener('click', saveResult);
  }

  async function init() {
    wireEvents();
    setNeedleSpeed(0);
    setAdsUnlocked(false);
    await loadHistory();
  }

  init();
})();
