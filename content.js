(() => {
  'use strict';

  const ROOT_ID = 'creator-toolkit';
  const TAGS_GRID_ID = 'ct-tags-grid';
  const COLLAPSE_KEY = 'ct_collapsed';
  const PROD_OPEN_KEY = 'ct_production_open';

  const AFFILIATE_LINKS = {
    intelligence: 'https://www.tubebuddy.com/',
    music: 'https://www.epidemicsound.com/',
    thumbnail: 'https://www.canva.com/',
    ai: 'https://www.copy.ai/',
  };

  let lastUrl = location.href;
  let lastTagSignature = '';
  let refreshIntervalId = 0;

  function normalizeTags(tags) {
    return [...new Set(tags.map((tag) => String(tag).trim()).filter(Boolean))];
  }

  function extractFromMetaKeywords() {
    const meta = document.querySelector('meta[name="keywords"]');
    if (!meta) return [];
    return (meta.getAttribute('content') || '').split(',');
  }

  function extractMetaVideoId() {
    const metaVideoId = document.querySelector('meta[itemprop="videoId"]');
    return (metaVideoId?.getAttribute('content') || '').trim();
  }

  function extractCanonicalVideoId() {
    const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href') || '';
    const ogUrl = document.querySelector('meta[property="og:url"]')?.getAttribute('content') || '';
    const candidate = canonical || ogUrl;
    if (!candidate) return '';

    try {
      return new URL(candidate).searchParams.get('v') || '';
    } catch {
      return '';
    }
  }

  function extractFromMoviePlayer() {
    const player = document.getElementById('movie_player');
    if (!player || typeof player.getVideoData !== 'function') {
      return { videoId: '', tags: [] };
    }

    try {
      const data = player.getVideoData() || {};
      const tags = Array.isArray(data.keywords) ? data.keywords : [];
      return { videoId: data.video_id || '', tags };
    } catch {
      return { videoId: '', tags: [] };
    }
  }

  function extractFromPlayerResponse() {
    const response = window.ytInitialPlayerResponse;
    return {
      videoId: response?.videoDetails?.videoId || '',
      tags: response?.videoDetails?.keywords || [],
    };
  }

  function extractFromYtcfgVars() {
    const ytcfgVars = window.ytcfg?.data_?.PLAYER_VARS;
    return {
      videoId: String(ytcfgVars?.video_id || ''),
      tags: ytcfgVars?.video_keywords
        ? String(ytcfgVars.video_keywords).split(',')
        : [],
    };
  }

  function extractFromInlineScripts(urlVideoId) {
    const scripts = document.querySelectorAll('script');
    const escapedVideoId = urlVideoId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pairRegex = new RegExp(
      `"videoId":"${escapedVideoId}"[\\s\\S]{0,8000}?"keywords":\\[(.*?)\\]`,
      'i',
    );

    for (const script of scripts) {
      const text = script.textContent || '';
      if (!text || !text.includes(urlVideoId) || !text.includes('"keywords"')) {
        continue;
      }

      const match = text.match(pairRegex);
      if (!match?.[1]) continue;

      const values = [...match[1].matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)].map((m) =>
        m[1].replace(/\\"/g, '"'),
      );

      if (values.length) return normalizeTags(values);
    }

    return [];
  }

  function getVideoTagsForCurrentUrl() {
    const urlVideoId = getVideoId();
    const canonicalVideoId = extractCanonicalVideoId();

    const fromPlayer = extractFromMoviePlayer();
    if (fromPlayer.videoId === urlVideoId && fromPlayer.tags.length) {
      return normalizeTags(fromPlayer.tags);
    }

    const fromResponse = extractFromPlayerResponse();
    if (fromResponse.videoId === urlVideoId && fromResponse.tags.length) {
      return normalizeTags(fromResponse.tags);
    }

    const scriptTags = extractFromInlineScripts(urlVideoId);
    if (scriptTags.length) {
      return scriptTags;
    }

    const metaVideoId = extractMetaVideoId();
    const fromMeta = extractFromMetaKeywords();
    const metaLooksCurrent =
      metaVideoId === urlVideoId ||
      (!!canonicalVideoId && canonicalVideoId === urlVideoId) ||
      !metaVideoId;
    if (metaLooksCurrent && fromMeta.length) {
      return normalizeTags(fromMeta);
    }

    const fromVars = extractFromYtcfgVars();
    if (fromVars.videoId === urlVideoId && fromVars.tags.length) {
      return normalizeTags(fromVars.tags);
    }

    if (!fromVars.videoId && fromVars.tags.length) {
      return normalizeTags(fromVars.tags);
    }

    // Never return stale tags from a previous video's state during SPA transition.
    return [];
  }

  function getVideoId() {
    const u = new URL(location.href);
    return u.searchParams.get('v') || 'video';
  }

  function getSidebarTarget() {
    return (
      document.querySelector('#secondary #secondary-inner') ||
      document.querySelector('#secondary-inner') ||
      document.querySelector('ytd-watch-flexy #secondary')
    );
  }

  function createIconButton(id, label, text) {
    const button = document.createElement('button');
    button.id = id;
    button.className = 'ct-icon-btn';
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.textContent = text;
    return button;
  }

  function createLink(text, href) {
    const a = document.createElement('a');
    a.className = 'ct-link';
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = text;
    return a;
  }

  function buildDashboard() {
    const root = document.createElement('aside');
    root.id = ROOT_ID;
    root.className = 'creator-toolkit';
    root.setAttribute('aria-label', 'Creator Toolkit');

    const header = document.createElement('header');
    header.className = 'creator-toolkit__header';

    const title = document.createElement('div');
    title.className = 'creator-toolkit__title';
    title.textContent = 'Creator Toolkit TagPilot';

    const headerActions = document.createElement('div');
    headerActions.className = 'creator-toolkit__header-actions';

    const refreshBtn = createIconButton('ct-refresh', 'Refresh tags', 'R');
    const collapseBtn = createIconButton('ct-collapse', 'Collapse dashboard', '-');

    headerActions.append(refreshBtn, collapseBtn);
    header.append(title, headerActions);

    const body = document.createElement('div');
    body.className = 'creator-toolkit__body';

    const tagsSection = document.createElement('section');
    tagsSection.className = 'ct-section';
    tagsSection.id = 'ct-tags-section';

    const tagsHead = document.createElement('div');
    tagsHead.className = 'ct-section__head';

    const tagsTitle = document.createElement('h3');
    tagsTitle.className = 'ct-section__title';
    tagsTitle.textContent = 'Video Keywords';

    const actions = document.createElement('div');
    actions.className = 'ct-actions';

    const copyBtn = createIconButton('ct-copy-all', 'Copy all tags', 'Copy');
    const csvBtn = createIconButton('ct-export-csv', 'Export tags as CSV', 'CSV');

    actions.append(copyBtn, csvBtn);
    tagsHead.append(tagsTitle, actions);

    const tagsGrid = document.createElement('div');
    tagsGrid.className = 'ct-tags-grid';
    tagsGrid.id = TAGS_GRID_ID;

    tagsSection.append(tagsHead, tagsGrid);

    const intelligence = document.createElement('section');
    intelligence.className = 'ct-section';
    intelligence.id = 'ct-intelligence-section';

    const intelligenceTitle = document.createElement('h3');
    intelligenceTitle.className = 'ct-section__title';
    intelligenceTitle.textContent = 'Keyword Intelligence';

    const metric = document.createElement('p');
    metric.className = 'ct-intel-metric';
    metric.textContent = 'Search Volume: Unlock with TubeBuddy';

    const cta = document.createElement('a');
    cta.className = 'ct-cta';
    cta.href = AFFILIATE_LINKS.intelligence;
    cta.target = '_blank';
    cta.rel = 'noopener noreferrer';
    cta.textContent = 'Analyze in Depth';

    intelligence.append(intelligenceTitle, metric, cta);

    const production = document.createElement('section');
    production.className = 'ct-section ct-accordion';
    production.id = 'ct-production-section';

    const trigger = document.createElement('button');
    trigger.className = 'ct-accordion__trigger';
    trigger.type = 'button';
    trigger.id = 'ct-production-toggle';
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', 'ct-production-links');
    trigger.textContent = 'Speed Up Your Production';

    const links = document.createElement('div');
    links.className = 'ct-links';
    links.id = 'ct-production-links';
    links.hidden = true;

    links.append(
      createLink('Claim Free Music Track', AFFILIATE_LINKS.music),
      createLink('Design a Thumbnail', AFFILIATE_LINKS.thumbnail),
      createLink('Generate AI Description', AFFILIATE_LINKS.ai),
    );

    production.append(trigger, links);

    body.append(tagsSection, intelligence, production);
    root.append(header, body);

    return root;
  }

  async function copyAll(tags, button) {
    const payload = tags.join(', ');
    if (!payload) return;

    try {
      await navigator.clipboard.writeText(payload);
    } catch {
      const fallback = document.createElement('textarea');
      fallback.value = payload;
      fallback.style.position = 'fixed';
      fallback.style.opacity = '0';
      document.body.appendChild(fallback);
      fallback.select();
      document.execCommand('copy');
      fallback.remove();
    }

    const old = button.textContent;
    button.textContent = 'Copied';
    setTimeout(() => {
      button.textContent = old;
    }, 1000);
  }

  function exportCsv(tags, button) {
    if (!tags.length) return;

    const content = `tag\n${tags.map((tag) => `"${tag.replace(/"/g, '""')}"`).join('\n')}`;
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `youtube-tags-${getVideoId()}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);

    const old = button.textContent;
    button.textContent = 'Done';
    setTimeout(() => {
      button.textContent = old;
    }, 900);
  }

  function createTagPill(tag) {
    const a = document.createElement('a');
    a.className = 'ct-tag';
    a.href = `https://www.youtube.com/results?search_query=${encodeURIComponent(tag)}`;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = tag;
    return a;
  }

  function applyCollapseState(root) {
    const isCollapsed = localStorage.getItem(COLLAPSE_KEY) === '1';
    root.classList.toggle('is-collapsed', isCollapsed);
    const collapseBtn = root.querySelector('#ct-collapse');

    if (collapseBtn) {
      collapseBtn.textContent = isCollapsed ? '+' : '-';
      collapseBtn.setAttribute('aria-label', isCollapsed ? 'Expand dashboard' : 'Collapse dashboard');
    }
  }

  function applyProductionState(root) {
    const isOpen = localStorage.getItem(PROD_OPEN_KEY) === '1';
    const trigger = root.querySelector('#ct-production-toggle');
    const links = root.querySelector('#ct-production-links');
    if (!trigger || !links) return;

    trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    links.hidden = !isOpen;
  }

  function refreshCurrentVideo(root, button) {
    const old = button.textContent;
    button.textContent = '...';
    button.disabled = true;

    lastUrl = location.href;
    lastTagSignature = '';
    render();
    scheduleFreshTagRefresh();

    setTimeout(() => {
      if (!document.body.contains(root)) return;
      button.textContent = old;
      button.disabled = false;
    }, 1000);
  }

  function wireEvents(root, tags) {
    const copyBtn = root.querySelector('#ct-copy-all');
    const csvBtn = root.querySelector('#ct-export-csv');
    const refreshBtn = root.querySelector('#ct-refresh');
    const collapseBtn = root.querySelector('#ct-collapse');
    const productionToggle = root.querySelector('#ct-production-toggle');

    if (copyBtn) {
      copyBtn.onclick = () => copyAll(tags, copyBtn);
    }

    if (csvBtn) {
      csvBtn.onclick = () => exportCsv(tags, csvBtn);
    }

    if (refreshBtn) {
      refreshBtn.onclick = () => refreshCurrentVideo(root, refreshBtn);
    }

    if (collapseBtn) {
      collapseBtn.onclick = () => {
        const nextCollapsed = !root.classList.contains('is-collapsed');
        localStorage.setItem(COLLAPSE_KEY, nextCollapsed ? '1' : '0');
        applyCollapseState(root);
      };
    }

    if (productionToggle) {
      productionToggle.onclick = () => {
        const current = localStorage.getItem(PROD_OPEN_KEY) === '1';
        localStorage.setItem(PROD_OPEN_KEY, current ? '0' : '1');
        applyProductionState(root);
      };
    }
  }

  function renderTagsGrid(root, tags) {
    const grid = root.querySelector(`#${TAGS_GRID_ID}`);
    if (!grid) return;

    grid.textContent = '';

    if (!tags.length) {
      const empty = document.createElement('p');
      empty.className = 'ct-empty';
      empty.textContent = 'No tags found for this video.';
      grid.append(empty);
      return;
    }

    tags.forEach((tag) => grid.append(createTagPill(tag)));
  }

  function ensureDashboard(target) {
    let root = document.getElementById(ROOT_ID);
    if (!root) {
      root = buildDashboard();
      target.prepend(root);
    } else if (root.parentElement !== target) {
      target.prepend(root);
    }
    return root;
  }

  function render() {
    if (!location.href.includes('youtube.com/watch')) {
      const existing = document.getElementById(ROOT_ID);
      if (existing) existing.remove();
      return;
    }

    const target = getSidebarTarget();
    if (!target) return;

    const urlVideoId = getVideoId();
    const tags = getVideoTagsForCurrentUrl();
    const signature = `${urlVideoId}::${tags.join('|')}`;
    const root = ensureDashboard(target);

    if (signature !== lastTagSignature) {
      lastTagSignature = signature;
      renderTagsGrid(root, tags);
    }

    applyCollapseState(root);
    applyProductionState(root);
    wireEvents(root, tags);
  }

  function scheduleRender(delay = 120) {
    clearTimeout(scheduleRender.timerId);
    scheduleRender.timerId = setTimeout(render, delay);
  }

  function scheduleFreshTagRefresh() {
    clearInterval(refreshIntervalId);
    let attempts = 0;

    refreshIntervalId = setInterval(() => {
      attempts += 1;
      render();

      const hasTags = getVideoTagsForCurrentUrl().length > 0;
      if (hasTags || attempts >= 14) {
        clearInterval(refreshIntervalId);
      }
    }, 350);
  }

  scheduleRender.timerId = 0;

  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastTagSignature = '';
      scheduleRender(180);
      scheduleFreshTagRefresh();
    }
  }, 700);

  const observer = new MutationObserver(() => {
    if (location.pathname === '/watch') {
      scheduleRender(160);
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener('yt-navigate-finish', () => {
    lastTagSignature = '';
    scheduleRender(100);
    scheduleFreshTagRefresh();
  });

  document.addEventListener('yt-navigate-start', () => {
    lastTagSignature = '';
    scheduleRender(60);
  });

  document.addEventListener('yt-page-data-updated', () => {
    lastTagSignature = '';
    scheduleRender(80);
    scheduleFreshTagRefresh();
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'GET_VIDEO_TAGS') return;
    sendResponse({ tags: getVideoTagsForCurrentUrl(), videoId: getVideoId() });
  });

  render();
})();


