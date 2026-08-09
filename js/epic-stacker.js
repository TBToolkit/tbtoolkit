
import { calculateEpicStack } from './epic-engine.mjs';

const STORAGE_KEY = 'tbtoolkit.epicStacker.v1';
const DATA_URLS = {
  troop: 'data/troops.json',
  monster: 'data/monsters.json',
  mercenary: 'data/mercenaries.json',
};

const els = {};
const units = { troop: [], monster: [], mercenary: [] };
const groups = { troop: [], monster: [], mercenary: [] };
let activeCategory = 'troop';

const state = {
  selectedKeys: { troop: [], monster: [], mercenary: [] },
  inputs: {
    leadership: '',
    leadershipFill: 99.99,
    authority: '',
    authorityFill: 99.99,
    dominance: '',
    dominanceFill: 99.99,
    monsterHealth: '',
    humanHealth: '',
    epicHunterHealth: '',
    arachne: false,
    rankSeparation: 0.40,
  },
};

function n(value) {
  const x = Number(value);
  return Number.isFinite(x) ? x : 0;
}

function integerFormat(value) {
  return Math.round(n(value)).toLocaleString('en-US');
}

function percentFormat(value, digits = 1) {
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

function cacheElements() {
  [
    'leadership','leadershipFill','authority','authorityFill','dominance','dominanceFill',
    'monsterHealth','humanHealth','epicHunterHealth','arachne','rankSeparation',
    'recalculate','resetCalculator','unitSelectGrid','selectAll','clearCategory',
    'troopCount','monsterCount','mercenaryCount','validationBox','resultStatus',
    'resultEmpty','resultGroups','troopResults','monsterResults','mercenaryResults',
    'leadershipBar','authorityBar','dominanceBar','leadershipActual','authorityActual','dominanceActual'
  ].forEach(id => els[id] = document.getElementById(id));
}

async function loadData() {
  const entries = await Promise.all(
    Object.entries(DATA_URLS).map(async ([key, url]) => {
      const response = await fetch(url, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`Could not load ${url}`);
      return [key, await response.json()];
    })
  );
  entries.forEach(([key, value]) => units[key] = value);
  for (const category of Object.keys(groups)) groups[category] = buildGroups(units[category]);
}

function buildGroups(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.selectionKey)) {
      map.set(row.selectionKey, {
        key: row.selectionKey,
        displayOrder: row.displayOrder,
        level: row.level,
        type: row.type,
        rows: [],
      });
    }
    const g = map.get(row.selectionKey);
    g.rows.push(row);
    g.displayOrder = Math.min(g.displayOrder, row.displayOrder);
  }
  return [...map.values()].sort((a,b) => a.displayOrder - b.displayOrder);
}

function loadSavedState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!saved) return;
    if (saved.selectedKeys) {
      for (const category of Object.keys(state.selectedKeys)) {
        if (Array.isArray(saved.selectedKeys[category])) state.selectedKeys[category] = saved.selectedKeys[category];
      }
    }
    if (saved.inputs) Object.assign(state.inputs, saved.inputs);
  } catch (_) {}
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function applyStateToInputs() {
  for (const id of ['leadership','leadershipFill','authority','authorityFill','dominance','dominanceFill','monsterHealth','humanHealth','epicHunterHealth','rankSeparation']) {
    els[id].value = state.inputs[id];
  }
  els.arachne.checked = !!state.inputs.arachne;
}

function readInputs() {
  for (const id of ['leadership','leadershipFill','authority','authorityFill','dominance','dominanceFill','monsterHealth','humanHealth','epicHunterHealth','rankSeparation']) {
    state.inputs[id] = els[id].value;
  }
  state.inputs.arachne = els.arachne.checked;
  saveState();
}

function updateCounts() {
  els.troopCount.textContent = state.selectedKeys.troop.length;
  els.monsterCount.textContent = state.selectedKeys.monster.length;
  els.mercenaryCount.textContent = state.selectedKeys.mercenary.length;
}

function renderSelectionGrid() {
  const selected = new Set(state.selectedKeys[activeCategory]);
  els.unitSelectGrid.innerHTML = '';

  for (const group of groups[activeCategory]) {
    const isSelected = selected.has(group.key);
    const label = document.createElement('label');
    label.className = `unit-option${isSelected ? ' selected' : ''}`;
    label.dataset.key = group.key;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = isSelected;
    checkbox.setAttribute('aria-label', `Select ${group.level} ${group.type}`);
    checkbox.addEventListener('change', () => toggleSelection(activeCategory, group.key, checkbox.checked));
    label.appendChild(checkbox);

    const iconWrap = document.createElement('div');
    if (group.rows.length > 1) {
      iconWrap.className = 'multi-icons';
      group.rows.slice(0,3).forEach(row => {
        const img = document.createElement('img');
        img.src = row.icon;
        img.alt = '';
        img.loading = 'lazy';
        iconWrap.appendChild(img);
      });
    } else {
      const img = document.createElement('img');
      img.src = group.rows[0].icon;
      img.alt = '';
      img.loading = 'lazy';
      iconWrap.appendChild(img);
    }
    label.appendChild(iconWrap);

    const copy = document.createElement('div');
    copy.className = 'unit-copy';
    const names = group.rows.map(r => r.name).join(' + ');
    copy.innerHTML = `
      <div class="unit-level">${escapeHtml(group.level)}</div>
      <div class="unit-type">${escapeHtml(group.type)}</div>
      <div class="unit-name" title="${escapeHtml(names)}">${escapeHtml(names)}</div>
      ${group.rows.length > 1 ? `<div class="unit-count-note">${group.rows.length} units selected together</div>` : ''}
    `;
    label.appendChild(copy);
    els.unitSelectGrid.appendChild(label);
  }
}

function toggleSelection(category, key, checked) {
  const set = new Set(state.selectedKeys[category]);
  checked ? set.add(key) : set.delete(key);
  state.selectedKeys[category] = [...set];
  saveState();
  updateCounts();
  renderSelectionGrid();
  recalculate();
}

function setCategory(category) {
  activeCategory = category;
  document.querySelectorAll('.category-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.category === category));
  renderSelectionGrid();
}

function selectAllCurrent() {
  state.selectedKeys[activeCategory] = groups[activeCategory].map(g => g.key);
  saveState();
  updateCounts();
  renderSelectionGrid();
  recalculate();
}

function clearCurrent() {
  state.selectedKeys[activeCategory] = [];
  saveState();
  updateCounts();
  renderSelectionGrid();
  recalculate();
}

function resetCalculator() {
  if (!confirm('Reset all Epic Stacker inputs and selections on this device?')) return;
  localStorage.removeItem(STORAGE_KEY);
  state.selectedKeys = { troop: [], monster: [], mercenary: [] };
  Object.assign(state.inputs, {
    leadership: '', leadershipFill: 99.99,
    authority: '', authorityFill: 99.99,
    dominance: '', dominanceFill: 99.99,
    monsterHealth: '', humanHealth: '', epicHunterHealth: '',
    arachne: false, rankSeparation: 0.40,
  });
  applyStateToInputs();
  updateCounts();
  renderSelectionGrid();
  clearResults();
}

function engineInputs() {
  return {
    leadership: n(state.inputs.leadership),
    leadershipFill: n(state.inputs.leadershipFill) / 100,
    authority: n(state.inputs.authority),
    authorityFill: n(state.inputs.authorityFill) / 100,
    dominance: n(state.inputs.dominance),
    dominanceFill: n(state.inputs.dominanceFill) / 100,
    arachne: !!state.inputs.arachne,
    healthInputs: {
      MONSTER: n(state.inputs.monsterHealth),
      HUMAN: n(state.inputs.humanHealth),
      EPIC_HUNTER: n(state.inputs.epicHunterHealth),
    },
    rankSeparation: n(state.inputs.rankSeparation) / 100,
  };
}

function validate() {
  const errors = [];
  const hasAny = Object.values(state.selectedKeys).some(arr => arr.length);
  if (!hasAny) return errors;

  const inp = engineInputs();
  if (!(inp.healthInputs.MONSTER > 0)) errors.push('Enter Monster Health.');
  if (!(inp.healthInputs.HUMAN > 0)) errors.push('Enter Human Health.');
  if (!(inp.healthInputs.EPIC_HUNTER > 0)) errors.push('Enter Epic Hunter Health.');

  if (state.selectedKeys.troop.length && !(inp.leadership > 0)) errors.push('Enter Leadership for selected Troops.');
  if (state.selectedKeys.monster.length && !(inp.dominance > 0)) errors.push('Enter Dominance for selected Monsters.');
  if (state.selectedKeys.mercenary.length && !(inp.authority > 0)) errors.push('Enter Authority for selected Mercenaries.');

  for (const [label, v] of [['Leadership % Full', inp.leadershipFill],['Authority % Full', inp.authorityFill],['Dominance % Full', inp.dominanceFill]]) {
    if (v < 0 || v > 1) errors.push(`${label} must be between 0 and 100.`);
  }
  if (inp.rankSeparation < 0) errors.push('Layer separation cannot be negative.');
  return errors;
}

function showValidation(errors) {
  if (!errors.length) {
    els.validationBox.classList.remove('show');
    els.validationBox.innerHTML = '';
    return;
  }
  els.validationBox.innerHTML = `<strong>Check these inputs:</strong><br>${errors.map(escapeHtml).join('<br>')}`;
  els.validationBox.classList.add('show');
}

function clearResults(message = 'Enter your values and select units.') {
  els.resultEmpty.hidden = false;
  els.resultGroups.hidden = true;
  els.resultStatus.textContent = message;
  for (const id of ['troopResults','monsterResults','mercenaryResults']) els[id].innerHTML = '';
  updateCapacity(null);
}

function renderResultRows(category, rows) {
  const target = els[`${category}Results`];
  target.innerHTML = '';
  if (!rows.length) {
    target.innerHTML = '<div class="result-empty" style="padding:16px">None selected.</div>';
    return;
  }
  rows.forEach(row => {
    const div = document.createElement('div');
    div.className = 'result-row';
    div.innerHTML = `
      <img src="${row.icon}" alt="" loading="lazy">
      <div class="result-unit">
        <strong>${escapeHtml(row.level)} · ${escapeHtml(row.type)}</strong>
        <span>${escapeHtml(row.name)}</span>
        <span class="result-debug">PvE ${Math.round(row.pve * 100)}% · Rank ${row.rank}</span>
      </div>
      <div class="result-qty">${integerFormat(row.qty)}<small>Qty</small></div>
    `;
    target.appendChild(div);
  });
}

function updateCapacity(result) {
  const configs = [
    ['leadership', result?.totals.leadership, n(state.inputs.leadership)],
    ['authority', result?.totals.authority, n(state.inputs.authority)],
    ['dominance', result?.totals.dominance, n(state.inputs.dominance)],
  ];
  for (const [name, actual, limit] of configs) {
    const bar = els[`${name}Bar`];
    const fill = bar.querySelector('i');
    const pct = limit > 0 && Number.isFinite(actual) ? actual / limit : 0;
    fill.style.width = `${Math.min(Math.max(pct * 100, 0), 100)}%`;
    bar.classList.toggle('over', pct > 1);
    els[`${name}Actual`].textContent = actual == null ? '—' : `${integerFormat(actual)} / ${limit ? integerFormat(limit) : '—'}`;
  }
}

function recalculate() {
  readInputs();
  const anySelected = Object.values(state.selectedKeys).some(arr => arr.length);
  if (!anySelected) {
    showValidation([]);
    clearResults('Select units to build your stack.');
    return;
  }

  const errors = validate();
  showValidation(errors);
  if (errors.length) {
    clearResults('Complete the required inputs.');
    return;
  }

  try {
    const result = calculateEpicStack({
      troops: units.troop,
      monsters: units.monster,
      mercenaries: units.mercenary,
      selectedKeys: state.selectedKeys,
      inputs: engineInputs(),
    });

    renderResultRows('mercenary', result.categories.mercenary.results);
    renderResultRows('monster', result.categories.monster.results);
    renderResultRows('troop', result.categories.troop.results);
    updateCapacity(result);

    const rowCount = result.categories.troop.results.length + result.categories.monster.results.length + result.categories.mercenary.results.length;
    els.resultStatus.textContent = `${rowCount} calculated unit layer${rowCount === 1 ? '' : 's'} · mobile entry order`;
    els.resultEmpty.hidden = true;
    els.resultGroups.hidden = false;
  } catch (error) {
    console.error(error);
    showValidation([error.message || 'The calculator could not complete the stack.']);
    clearResults('Calculation error.');
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#039;');
}

function wireEvents() {
  document.querySelectorAll('.category-tab').forEach(btn => btn.addEventListener('click', () => setCategory(btn.dataset.category)));
  els.selectAll.addEventListener('click', selectAllCurrent);
  els.clearCategory.addEventListener('click', clearCurrent);
  els.recalculate.addEventListener('click', recalculate);
  els.resetCalculator.addEventListener('click', resetCalculator);

  for (const id of ['leadership','leadershipFill','authority','authorityFill','dominance','dominanceFill','monsterHealth','humanHealth','epicHunterHealth','rankSeparation']) {
    els[id].addEventListener('input', () => {
      readInputs();
      recalculate();
    });
  }
  els.arachne.addEventListener('change', () => {
    readInputs();
    recalculate();
  });
}

async function init() {
  cacheElements();
  loadSavedState();
  applyStateToInputs();
  wireEvents();
  try {
    await loadData();
    updateCounts();
    renderSelectionGrid();
    recalculate();
  } catch (error) {
    console.error(error);
    showValidation(['The unit database could not be loaded. Refresh the page and try again.']);
  }
}
init();
