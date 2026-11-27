/* ========== 全局状态 ========== */
const STATIC_DATA = window.__STATIC_DATA__ || null;
const STATIC = !!STATIC_DATA;
const STATIC_BANKS = STATIC ? (STATIC_DATA.banks || {}) : {};
const COURSE_WORD = STATIC ? '题库' : '课程';

const state = {
  courses: [],
  currentCourseId: localStorage.getItem('currentCourseId') || null,
  questions: [],
  practiceQuestions: [],
  bankFilter: 'all',
  // 刷题会话
  session: null,      // { questions: [], index: 0, records: [] }
};

const EXAM_RULES = { single: 40, multiple: 20, judge: 20, multipleScore: 40 };

const TYPE_LABEL = { single: '单选题', multiple: '多选题', judge: '判断题' };
const TYPE_BADGE = { single: 'single', multiple: 'multiple', judge: 'judge' };
const OPT_KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

const FORMAT_HELP = `支持 Word(.docx) / PDF(.pdf) / JSON(.json) 三种导入方式，两种文字格式可混用。

【格式一：内联式】题型和答案写在题干里（最常见）：
1【单选题】（D）被誉为"美国近代园林之父"。
A、佐佐木英夫
B、贝聿铭
C、勒·柯布西耶
D、奥姆斯特德

2【多选题】"西湖三岛"包括（ABD）。
A、小瀛洲
B、湖心亭
C、孤山
D、阮公墩

3【判断题】在园林设计中，地形与水体是园林创作首先要解决的问题。（√）

【格式二：分列式】题型用标题行、答案独立一行：
一、单选题
1. 下列哪个是传输层协议？（ ）
A. IP
B. TCP
C. ICMP
D. ARP
答案：B

三、判断题
1. TCP 是面向连接的协议。（ ）
答案：对

说明：
· 题型关键字：单选/单项、多选/多项/不定项、判断/是非
· 题号可写 1. / 1、 / 1． / 1） / (1)，也可无题号直接以【题型】开头
· 答案：题干内括号（B）（ABD）（√）（×）（对）（错），或“答案：”“【答案】”
· 判断题答案支持：对/正确/√/T 或 错/错误/×/F
· 解析（可选）：“解析：”“【解析】”
· ⚠️ 扫描版/纯图片型 PDF 无法提取文字，需先 OCR 转成可复制文字的 PDF`;

/* ========== 工具函数 ========== */
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return Array.from(document.querySelectorAll(sel)); }

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2200);
}

function calcCounts(questions) {
  const c = { total: questions.length, single: 0, multiple: 0, judge: 0,
              verified: 0, bank_only: 0, corrected: 0 };
  for (const q of questions) {
    if (c[q.type] !== undefined) c[q.type]++;
    if (q.verified) c.verified++; else c.bank_only++;
    if (q.corrected) c.corrected++;
  }
  return c;
}

function shuffleCopy(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ========== 模拟考试 ========== */
function filterByScope(questions, scope) {
  return questions.filter(q => (
    scope === 'verified' ? q.verified
      : scope === 'unverified' ? !q.verified
        : true
  ));
}

function formatPoints(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

function examPlanFor(questions) {
  const c = calcCounts(questions);
  const single = Math.min(EXAM_RULES.single, c.single);
  const multiple = Math.min(EXAM_RULES.multiple, c.multiple);
  const judge = Math.min(EXAM_RULES.judge, c.judge);
  const perMultiple = multiple ? EXAM_RULES.multipleScore / multiple : 0;
  return {
    single, multiple, judge, perMultiple,
    total: single + judge + (multiple ? EXAM_RULES.multipleScore : 0),
  };
}

// 选项乱序的题目副本：答案索引随选项一起重映射（判断题为“正确/错误”，保持固定顺序）
function examQuestionCopy(q) {
  if (q.type === 'judge') {
    return { ...q, options: q.options.slice(), answer: q.answer.slice() };
  }
  const entries = q.options.map((text, i) => ({ text, correct: q.answer.includes(i) }));
  const shuffled = shuffleCopy(entries);
  return {
    ...q,
    options: shuffled.map(e => e.text),
    answer: shuffled.map((e, i) => (e.correct ? i : -1)).filter(i => i >= 0),
  };
}

function buildExamPaper(pool) {
  const groups = { single: [], multiple: [], judge: [] };
  pool.forEach(q => { if (groups[q.type]) groups[q.type].push(q); });
  const picked = [];
  for (const t of ['single', 'multiple', 'judge']) {
    picked.push(...shuffleCopy(groups[t]).slice(0, EXAM_RULES[t]));
  }
  const questions = picked.map(examQuestionCopy);
  const plan = examPlanFor(questions);
  return { questions, plan };
}

/* ========== 静态版适配器 ========== */
function staticApi(path, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    return Promise.reject(new Error('静态版为只读，请在本地版中修改题库'));
  }
  const [pathname, queryStr] = String(path).split('?');
  const query = Object.fromEntries(new URLSearchParams(queryStr || ''));

  if (pathname === '/api/courses') {
    return Promise.resolve({ courses: STATIC_DATA.courses || [] });
  }

  let m = pathname.match(/^\/api\/courses\/([^/]+)\/questions$/);
  if (m) {
    const questions = (STATIC_BANKS[m[1]] || []);
    return Promise.resolve({ questions, counts: calcCounts(questions) });
  }

  m = pathname.match(/^\/api\/courses\/([^/]+)\/practice$/);
  if (m) {
    const all = (STATIC_BANKS[m[1]] || []);
    const mode = query.mode === 'order' ? 'order' : 'shuffle';
    const scope = ['all', 'verified', 'unverified'].includes(query.scope) ? query.scope : 'all';
    let list = all.filter(q => scope === 'verified' ? q.verified : scope === 'unverified' ? !q.verified : true);
    if (mode !== 'order') {
      const groups = { single: [], multiple: [], judge: [] };
      list.forEach(q => { if (groups[q.type]) groups[q.type].push(q); });
      list = [...shuffleCopy(groups.single), ...shuffleCopy(groups.multiple), ...shuffleCopy(groups.judge)];
    }
    return Promise.resolve({ questions: list, counts: calcCounts(all), mode, scope });
  }

  return Promise.reject(new Error('静态版不支持该接口'));
}

async function api(path, opts = {}) {
  if (STATIC) return staticApi(path, opts);
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

function typeBadge(t) {
  return `<span class="badge ${TYPE_BADGE[t]}">${TYPE_LABEL[t]}</span>`;
}

function sourceBadge(q) {
  return q.verified
    ? '<span class="badge verified">✓ 学习通已确认</span>'
    : '<span class="badge bank">仅题库</span>';
}

function correctedBadge(q) {
  return q.corrected ? '<span class="badge corrected">已订正</span>' : '';
}

function sourceBadges(q) {
  return sourceBadge(q) + correctedBadge(q);
}

function sourceNoteInfo(q) {
  if (q.corrected) {
    return {
      cls: 'source-note corrected',
      text: '答案已订正' + (q.source_detail ? '（' + q.source_detail + '）' : '') + '。',
    };
  }
  if (q.verified) {
    return {
      cls: 'source-note verified',
      text: '学习通已确认：该题在做题记录中出现过，答案有平台判定。',
    };
  }
  return {
    cls: 'source-note',
    text: '仅题库：该题只在题库/参考文档中出现，答案未经学习通验证。',
  };
}

function answerText(q) {
  if (q.type === 'judge') return q.answer[0] === 0 ? '正确' : '错误';
  return q.answer.map(i => OPT_KEYS[i]).join('');
}

function answerTextWithContent(q) {
  if (q.type === 'judge') return q.answer[0] === 0 ? '正确' : '错误';
  return q.answer.map(i => `${OPT_KEYS[i]}.${q.options[i] || ''}`).join('、');
}

/* ========== 视图切换 ========== */
function switchView(view) {
  $$('.view').forEach(v => v.classList.remove('active'));
  $('#view-' + view).classList.add('active');
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  window.scrollTo(0, 0);
  if (view === 'courses') loadCourses();
  if (view === 'bank') loadBank();
  if (view === 'practice') loadPracticeStart();
}

$$('.nav-btn').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view)));

function updateCourseBadge() {
  const c = state.courses.find(c => c.id === state.currentCourseId);
  $('#currentCourseBadge').textContent = c
    ? '当前' + COURSE_WORD + '：' + c.name
    : '未选择' + COURSE_WORD;
}

function selectCourse(id) {
  state.currentCourseId = id;
  localStorage.setItem('currentCourseId', id);
  updateCourseBadge();
  renderCourses();
}

/* ========== 课程管理 ========== */
async function loadCourses() {
  const data = await api('/api/courses');
  state.courses = data.courses;
  if (!state.courses.find(c => c.id === state.currentCourseId)) {
    state.currentCourseId = state.courses.length ? state.courses[0].id : null;
    if (state.currentCourseId) localStorage.setItem('currentCourseId', state.currentCourseId);
    else localStorage.removeItem('currentCourseId');
  }
  updateCourseBadge();
  renderCourses();
}

function renderCourses() {
  const list = $('#courseList');
  if (!state.courses.length) {
    list.innerHTML = '<div class="empty">还没有课程，先新建一个吧～</div>';
    return;
  }
  list.innerHTML = state.courses.map(c => {
    const ct = c.counts || calcCounts(STATIC_BANKS[c.id] || []);
    const current = c.id === state.currentCourseId;
    const actions = STATIC
      ? '<button class="btn primary small" data-act="practice">开始刷题</button>'
      : `<button class="btn primary small" data-act="select">${current ? '✓ 当前课程' : '设为当前'}</button>
         <button class="btn small" data-act="practice">开始刷题</button>
         <button class="btn danger small" data-act="delete">删除</button>`;
    return `
    <div class="course-card ${current ? 'current' : ''}" data-id="${c.id}">
      <div class="name">${escapeHtml(c.name)}</div>
      <div class="count">共 ${ct.total} 题</div>
      <div class="source-line">
        <b>✓ 学习通已确认 ${ct.verified}</b>
        <span class="bank-count">· 仅题库 ${ct.bank_only}</span>
      </div>
      <div class="actions">${actions}</div>
    </div>`;
  }).join('');

  list.querySelectorAll('.course-card').forEach(card => {
    card.addEventListener('click', async (e) => {
      const act = e.target.dataset.act;
      const id = card.dataset.id;
      if (act === 'delete') {
        if (!confirm('确定删除该课程及其所有题目？此操作不可恢复。')) return;
        await api('/api/courses/' + id, { method: 'DELETE' });
        if (state.currentCourseId === id) { state.currentCourseId = null; localStorage.removeItem('currentCourseId'); }
        toast('已删除课程');
        loadCourses();
      } else if (act === 'practice') {
        selectCourse(id);
        switchView('practice');
      } else {
        selectCourse(id);
        if (STATIC) {
          switchView('practice');
          return;
        }
        toast('已切换到：' + card.querySelector('.name').textContent);
      }
    });
  });
}

$('#btnAddCourse').addEventListener('click', async () => {
  const name = $('#newCourseName').value.trim();
  if (!name) return toast('请输入课程名称');
  const data = await api('/api/courses', { method: 'POST', body: { name } });
  selectCourse(data.course.id);
  $('#newCourseName').value = '';
  toast('课程已创建');
  loadCourses();
});

/* ========== 题库管理 ========== */
async function loadBank() {
  if (!state.currentCourseId) {
    $('#bankCourseName').textContent = '（请先在“课程”页选择或新建课程）';
    $('#bankStats').innerHTML = '';
    $('#questionList').innerHTML = '';
    return;
  }
  const course = state.courses.find(c => c.id === state.currentCourseId);
  $('#bankCourseName').textContent = '· ' + (course ? course.name : '');
  const data = await api('/api/courses/' + state.currentCourseId + '/questions');
  state.questions = data.questions;
  renderBankStats(data.counts);
  updateBankFilter(data.counts);
  renderQuestionList();
}

function renderBankStats(counts) {
  $('#bankStats').innerHTML = `
    <div class="stat"><div class="num">${counts.total}</div><div class="label">总题数</div></div>
    <div class="stat"><div class="num">${counts.single}</div><div class="label">单选题</div></div>
    <div class="stat"><div class="num">${counts.multiple}</div><div class="label">多选题</div></div>
    <div class="stat"><div class="num">${counts.judge}</div><div class="label">判断题</div></div>
    <div class="stat"><div class="num" style="color:var(--green)">${counts.verified || 0}</div><div class="label">学习通已确认</div></div>
    <div class="stat"><div class="num" style="color:var(--gray-text)">${counts.bank_only || 0}</div><div class="label">仅题库</div></div>
    ${counts.corrected ? `<div class="stat"><div class="num" style="color:var(--amber)">${counts.corrected}</div><div class="label">已订正</div></div>` : ''}`;
}

function updateBankFilter(counts) {
  const values = { all: counts.total, verified: counts.verified || 0, unverified: counts.bank_only || 0 };
  const labels = { all: '全部', verified: '学习通已确认', unverified: '仅题库' };
  if (!values[state.bankFilter]) state.bankFilter = 'all';
  $$('#bankFilter .filter-btn').forEach(btn => {
    const key = btn.dataset.filter;
    btn.textContent = `${labels[key]} ${values[key]}`;
    btn.disabled = !values[key];
    btn.classList.toggle('active', key === state.bankFilter);
  });
}

function renderQuestionList() {
  const listEl = $('#questionList');
  if (!state.questions.length) {
    listEl.innerHTML = '<div class="empty">题库为空，请先导入或手动添加题目。</div>';
    return;
  }
  const visible = state.questions.filter(q => (
    state.bankFilter === 'verified' ? q.verified
      : state.bankFilter === 'unverified' ? !q.verified
        : true
  ));
  if (!visible.length) {
    listEl.innerHTML = '<div class="empty">该筛选范围暂无题目。</div>';
    return;
  }

  listEl.innerHTML = visible.map((q, i) => {
    const unverified = !q.verified;
    const section = q.chapter
      ? `<span class="q-section">${escapeHtml(q.chapter)}</span>`
      : '';
    const actions = STATIC
      ? '<button class="btn small" data-act="toggle">展开</button>'
      : `<button class="btn small" data-act="toggle">展开</button>
         <button class="btn small" data-act="edit">更正</button>
         <button class="btn danger small" data-act="del">删除</button>`;
    return `
    <div class="question-item ${unverified ? 'unverified' : ''}" data-id="${q.id}">
      <div class="q-body">
        <div class="q-meta">
          ${typeBadge(q.type)}
          ${sourceBadges(q)}
          ${section}
        </div>
        <p class="q-stem">${i + 1}. ${escapeHtml(q.stem)}</p>
        <div class="q-answer">答案：${answerTextWithContent(q)}${q.explanation ? '　｜　解析：' + escapeHtml(q.explanation) : ''}</div>
        <div class="q-options hidden">
          ${q.options.map((opt, j) => `
            <div class="q-opt ${q.answer.includes(j) ? 'correct' : ''}">${OPT_KEYS[j]}. ${escapeHtml(opt)}</div>
          `).join('')}
        </div>
      </div>
      <div class="q-actions">${actions}</div>
    </div>`;
  }).join('');

  // 展开/收起选项
  listEl.querySelectorAll('[data-act="toggle"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.question-item');
      const opts = item.querySelector('.q-options');
      opts.classList.toggle('hidden');
      btn.textContent = opts.classList.contains('hidden') ? '展开' : '收起';
    });
  });

  // 更正按钮
  listEl.querySelectorAll('[data-act="edit"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.closest('.question-item').dataset.id;
      const q = state.questions.find(q => q.id === id);
      if (q) openEditModal(q);
    });
  });

  // 删除按钮
  listEl.querySelectorAll('[data-act="del"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('.question-item').dataset.id;
      if (!confirm('确定删除这道题？')) return;
      await api('/api/courses/' + state.currentCourseId + '/questions/' + id, { method: 'DELETE' });
      toast('已删除');
      loadBank();
    });
  });
}

$$('#bankFilter .filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    state.bankFilter = btn.dataset.filter;
    $$('#bankFilter .filter-btn').forEach(b => b.classList.toggle('active', b === btn));
    renderQuestionList();
  });
});

/* --- 导入 --- */
$('#importFile').addEventListener('change', e => {
  const f = e.target.files[0];
  $('#importFileName').textContent = f ? f.name : '';
});

$('#btnImport').addEventListener('click', async () => {
  if (!state.currentCourseId) return toast('请先选择课程');
  const file = $('#importFile').files[0];
  if (!file) return toast('请先选择要导入的文件');
  const mode = document.querySelector('input[name="importMode"]:checked').value;
  const btn = $('#btnImport');
  btn.disabled = true;
  btn.textContent = '导入中…';
  const resultEl = $('#importResult');
  resultEl.className = 'import-result';
  resultEl.textContent = '正在解析…';

  try {
    let payload;
    if (/\.json$/i.test(file.name)) {
      const text = await file.text();
      const obj = JSON.parse(text);
      const questions = Array.isArray(obj) ? obj : (obj.questions || []);
      payload = { mode, questions };
    } else {
      const b64 = await fileToBase64(file);
      payload = { mode, filename: file.name, data_base64: b64 };
    }
    const data = await api('/api/courses/' + state.currentCourseId + '/import', { method: 'POST', body: payload });
    resultEl.classList.add('ok');
    resultEl.innerHTML = `✅ 成功导入 <b>${data.imported}</b> 题` +
      (data.skipped ? `，跳过 <b>${data.skipped}</b> 题` : '') +
      (data.errors && data.errors.length ? `<br>⚠️ ${data.errors.slice(0, 10).map(escapeHtml).join('<br>')}` : '');
    toast('导入完成');
    loadBank();
  } catch (err) {
    resultEl.classList.add('err');
    resultEl.textContent = '导入失败：' + err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = '开始导入';
  }
});

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

$('#fmtHelpText').textContent = FORMAT_HELP;

/* --- 手动添加题目 --- */
function renderOptionEditor() {
  const type = $('#qType').value;
  const judgeArea = $('#qJudgeArea');
  const optArea = $('#qOptionsArea');
  if (type === 'judge') {
    judgeArea.classList.remove('hidden');
    optArea.innerHTML = '';
    return;
  }
  judgeArea.classList.add('hidden');
  const count = optArea.dataset.count ? parseInt(optArea.dataset.count) : (type === 'single' ? 4 : 4);
  if (!optArea.dataset.count) optArea.dataset.count = count;
  optArea.innerHTML = Array.from({ length: count }, (_, i) => optionRow(i, type)).join('') +
    `<button class="btn small" id="btnAddOption">＋ 添加选项</button>`;

  $('#btnAddOption').addEventListener('click', () => {
    optArea.dataset.count = parseInt(optArea.dataset.count) + 1;
    renderOptionEditor();
  });
  optArea.querySelectorAll('.opt-remove').forEach(b => b.addEventListener('click', () => {
    if (parseInt(optArea.dataset.count) <= 2) return toast('至少保留 2 个选项');
    optArea.dataset.count = parseInt(optArea.dataset.count) - 1;
    renderOptionEditor();
  }));
}

function optionRow(i, type) {
  const inputType = type === 'single' ? 'radio' : 'checkbox';
  const name = type === 'single' ? 'optCorrect' : 'optCorrect';
  return `<div class="option-editor">
    <span class="opt-label">${OPT_KEYS[i]}</span>
    <input type="text" class="opt-text" placeholder="选项内容" />
    <label class="correct-mark"><input type="${inputType}" name="${name}" ${i === 0 ? 'checked' : ''} /> 正确答案</label>
    <button class="btn danger small opt-remove">删除</button>
  </div>`;
}

$('#qType').addEventListener('change', renderOptionEditor);

$('#btnAddQuestion').addEventListener('click', async () => {
  if (!state.currentCourseId) return toast('请先选择课程');
  const type = $('#qType').value;
  const stem = $('#qStem').value.trim();
  if (!stem) return toast('请输入题干');

  let options = [], answer = [], explanation = $('#qExplanation').value.trim();

  if (type === 'judge') {
    options = ['正确', '错误'];
    answer = [parseInt(document.querySelector('input[name="judgeAnswer"]:checked').value)];
  } else {
    const rows = $$('#qOptionsArea .option-editor');
    options = rows.map(r => r.querySelector('.opt-text').value.trim());
    if (options.some(o => !o)) return toast('请填写所有选项内容');
    const marks = rows.map(r => r.querySelector('input[name="optCorrect"]').checked);
    answer = marks.map((m, i) => m ? i : -1).filter(i => i >= 0);
    if (!answer.length) return toast('请标记正确答案');
  }

  await api('/api/courses/' + state.currentCourseId + '/questions', {
    method: 'POST',
    body: { type, stem, options, answer, explanation },
  });
  toast('题目已保存');
  $('#qStem').value = '';
  $('#qExplanation').value = '';
  $$('#qOptionsArea .opt-text').forEach(i => i.value = '');
  loadBank();
});

$('#btnClearBank').addEventListener('click', async () => {
  if (!state.currentCourseId) return;
  if (!confirm('确定清空当前课程的全部题目？此操作不可恢复。')) return;
  await api('/api/courses/' + state.currentCourseId + '/bank', { method: 'DELETE' });
  toast('题库已清空');
  loadBank();
});

/* ========== 更正弹窗 ========== */
let editingQuestion = null;

function openEditModal(q) {
  editingQuestion = q;
  $('#editStem').textContent = q.stem;
  $('#editExplanation').value = q.explanation || '';

  const optArea = $('#editOptionsArea');
  const judgeArea = $('#editJudgeArea');

  if (q.type === 'judge') {
    judgeArea.classList.remove('hidden');
    optArea.innerHTML = '';
    const val = q.answer[0];
    judgeArea.querySelectorAll('input[name="editJudgeAnswer"]').forEach(r => {
      r.checked = parseInt(r.value) === val;
    });
  } else {
    judgeArea.classList.add('hidden');
    const inputType = q.type === 'single' ? 'radio' : 'checkbox';
    optArea.innerHTML = q.options.map((opt, i) => `
      <div class="edit-option">
        <span class="opt-label">${OPT_KEYS[i]}</span>
        <input type="text" value="${escapeHtml(opt)}" data-i="${i}" />
        <label><input type="${inputType}" name="editOptCorrect" data-i="${i}" ${q.answer.includes(i) ? 'checked' : ''} /> 正确</label>
      </div>`).join('');
  }
  $('#editModal').classList.remove('hidden');
}

function closeEditModal() {
  $('#editModal').classList.add('hidden');
  editingQuestion = null;
}

$('#btnCloseEdit').addEventListener('click', closeEditModal);
$('#btnCancelEdit').addEventListener('click', closeEditModal);

$('#btnSaveEdit').addEventListener('click', async () => {
  if (!editingQuestion) return;
  const q = editingQuestion;
  const updates = {};

  if (q.type === 'judge') {
    const checked = document.querySelector('input[name="editJudgeAnswer"]:checked');
    updates.answer = [parseInt(checked.value)];
  } else {
    const rows = $$('#editOptionsArea .edit-option');
    updates.options = rows.map(r => r.querySelector('input[type="text"]').value.trim());
    if (updates.options.some(o => !o)) return toast('请填写所有选项');
    const marks = rows.map(r => r.querySelector('input[name="editOptCorrect"]').checked);
    updates.answer = marks.map((m, i) => m ? i : -1).filter(i => i >= 0);
    if (!updates.answer.length) return toast('请标记正确答案');
  }

  updates.explanation = $('#editExplanation').value.trim();

  try {
    await api('/api/courses/' + state.currentCourseId + '/questions/' + q.id, {
      method: 'PUT',
      body: updates,
    });
    toast('已更正');
    closeEditModal();
    loadBank();
  } catch (err) {
    toast('保存失败：' + err.message);
  }
});

/* ========== 刷易混 ========== */
const YIHUN_KEY = 'shuatibao-yihun-';
let yihunAllQuestions = [];
let yihunSelected = [];
let yihunModalMode = 'start';

function loadYihun(courseId) {
  try {
    const arr = JSON.parse(localStorage.getItem(YIHUN_KEY + courseId) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

function saveYihun(courseId, ids) {
  localStorage.setItem(YIHUN_KEY + courseId, JSON.stringify(ids));
}

function startYihun() {
  const ids = loadYihun(state.currentCourseId);
  if (!ids.length) {
    openYihunModal('start'); // 初次使用：弹出完整题单供勾选
    return;
  }
  beginYihunPractice(ids);
}

function beginYihunPractice(ids) {
  if (!ids.length) return toast('请至少勾选一道易混题');
  const idSet = new Set(ids);
  let pool = state.practiceQuestions.filter(q => idSet.has(q.id));
  if (!pool.length) pool = yihunAllQuestions.filter(q => idSet.has(q.id));
  if (!pool.length) return toast('易混题单为空或题目已变化，请重新勾选');
  // 选项顺序打乱（判断题保持“正确/错误”固定顺序）
  const questions = shuffleCopy(pool).map(examQuestionCopy);
  state.session = {
    exam: false,
    yihun: true,
    questions,
    index: 0,
    scope: 'all',
    records: questions.map(() => ({ selected: null, skipped: false, guessed: false })),
  };
  $('#practiceStart').classList.add('hidden');
  $('#practiceResult').classList.add('hidden');
  $('#practiceQuiz').classList.remove('hidden');
  window.scrollTo(0, 0);
  renderQuestion();
}

// 做题时把当前题加入易混题单（乱序/顺序/考试模式可用；刷易混模式本身不显示）
$('#btnAddYihun').addEventListener('click', () => {
  if (!state.currentCourseId) return toast('请先选择题库');
  const q = currentQuestion();
  if (!q || !q.id) return toast('当前题目缺少编号，无法加入');
  const ids = loadYihun(state.currentCourseId);
  if (ids.includes(q.id)) {
    toast('该题已加入');
  } else {
    ids.push(q.id);
    saveYihun(state.currentCourseId, ids);
    toast('加入成功');
  }
});

async function openYihunModal(mode) {
  yihunModalMode = mode;
  if (!state.currentCourseId) return toast('请先选择题库');
  const data = await api('/api/courses/' + state.currentCourseId + '/questions');
  yihunAllQuestions = data.questions || [];
  yihunSelected = loadYihun(state.currentCourseId);
  const validIds = new Set(yihunAllQuestions.map(q => q.id));
  yihunSelected = yihunSelected.filter(id => validIds.has(id));
  $('#yihunSearch').value = '';
  renderYihunList('');
  $('#btnSaveYihun').textContent = mode === 'start' ? '保存并开始' : '保存';
  $('#yihunModal').classList.remove('hidden');
}

function yihunOptionsHtml(q) {
  if (q.type === 'judge') return '';
  return `<span class="yihun-opts">` +
    q.options.map((o, i) => `<span class="yihun-opt">${OPT_KEYS[i]}. ${escapeHtml(o)}</span>`).join('') +
    `</span>`;
}

function renderYihunList(filter) {
  const kw = (filter || '').trim();
  const sel = new Set(yihunSelected);
  const list = yihunAllQuestions.filter(q => {
    if (!kw) return true;
    if ((q.stem || '').includes(kw)) return true;
    return (q.options || []).some(o => (o || '').includes(kw));
  });
  if (!list.length) {
    $('#yihunList').innerHTML = '<div class="empty">没有匹配的题目。</div>';
  } else {
    $('#yihunList').innerHTML = list.map((q) => {
      const checked = sel.has(q.id);
      return `
      <label class="yihun-item ${checked ? 'checked' : ''}">
        <input type="checkbox" data-id="${q.id}" ${checked ? 'checked' : ''} />
        <span class="yihun-body">
          <span class="yihun-head">
            <span class="yihun-meta">${typeBadge(q.type)}</span>
            <span class="yihun-stem">${escapeHtml(q.stem)}</span>
          </span>
          ${yihunOptionsHtml(q)}
        </span>
      </label>`;
    }).join('');
  }
  const n = yihunSelected.length;
  $('#yihunCount').textContent = `已选 ${n} / ${yihunAllQuestions.length} 题`;

  $('#yihunList').querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.id;
      if (cb.checked) {
        if (!yihunSelected.includes(id)) yihunSelected.push(id);
      } else {
        yihunSelected = yihunSelected.filter(x => x !== id);
      }
      cb.closest('.yihun-item').classList.toggle('checked', cb.checked);
      $('#yihunCount').textContent = `已选 ${yihunSelected.length} / ${yihunAllQuestions.length} 题`;
    });
  });
}

$('#btnManageYihun').addEventListener('click', () => openYihunModal('manage'));
$('#btnCloseYihun').addEventListener('click', () => $('#yihunModal').classList.add('hidden'));
$('#btnCancelYihun').addEventListener('click', () => $('#yihunModal').classList.add('hidden'));
$('#yihunSearch').addEventListener('input', () => renderYihunList($('#yihunSearch').value));

$('#btnYihunAll').addEventListener('click', () => {
  yihunSelected = yihunAllQuestions.map(q => q.id);
  renderYihunList($('#yihunSearch').value);
});
$('#btnYihunNone').addEventListener('click', () => {
  yihunSelected = [];
  renderYihunList($('#yihunSearch').value);
});

$('#btnSaveYihun').addEventListener('click', () => {
  saveYihun(state.currentCourseId, yihunSelected);
  $('#yihunModal').classList.add('hidden');
  const mode = yihunModalMode;
  if (mode === 'start') {
    beginYihunPractice(yihunSelected);
  } else {
    toast('易混题单已保存（' + yihunSelected.length + ' 题）');
    updateExamInfo();
  }
});

/* ========== 刷题 ========== */
async function loadPracticeStart() {
  const start = $('#practiceStart'), quiz = $('#practiceQuiz'), result = $('#practiceResult');
  quiz.classList.add('hidden'); result.classList.add('hidden');
  state.practiceQuestions = [];
  $('#examInfo').classList.add('hidden');
  updateExamInfo();
  if (!state.currentCourseId) {
    start.classList.remove('hidden');
    $('#practiceCourseName').textContent = '';
    $('#practiceStats').innerHTML = `<div class="empty">请先在“${STATIC ? '题库' : '课程'}”页选择${COURSE_WORD}。</div>`;
    return;
  }
  const course = state.courses.find(c => c.id === state.currentCourseId);
  const data = await api('/api/courses/' + state.currentCourseId + '/practice');
  state.practiceQuestions = data.questions;
  if (!data.questions.length) {
    start.classList.remove('hidden');
    $('#practiceCourseName').textContent = course ? '当前' + COURSE_WORD + '：' + course.name : '';
    $('#practiceStats').innerHTML = '<div class="empty">该题库为空。</div>';
    return;
  }
  const c = data.counts;
  start.classList.remove('hidden');
  $('#practiceCourseName').textContent = course ? '当前' + COURSE_WORD + '：' + course.name : '';
  $('#scopeAllCount').textContent = `（${c.total} 题）`;
  $('#scopeVerifiedCount').textContent = `（${c.verified} 题）`;
  $('#scopeUnverifiedCount').textContent = `（${c.bank_only} 题）`;

  const scopeValues = { all: c.total, verified: c.verified, unverified: c.bank_only };
  $$('input[name="practiceScope"]').forEach(radio => {
    const n = scopeValues[radio.value] || 0;
    radio.disabled = n === 0;
    radio.closest('.mode-card').classList.toggle('disabled', n === 0);
    if (radio.checked && n === 0) {
      const all = $('input[name="practiceScope"][value="all"]');
      if (all) all.checked = true;
    }
  });

  $('#practiceStats').innerHTML = `
    <div class="stat"><div class="num">${c.total}</div><div class="label">总题数</div></div>
    <div class="stat"><div class="num">${c.single}</div><div class="label">单选题</div></div>
    <div class="stat"><div class="num">${c.multiple}</div><div class="label">多选题</div></div>
    <div class="stat"><div class="num">${c.judge}</div><div class="label">判断题</div></div>
    <div class="stat"><div class="num" style="color:var(--green)">${c.verified}</div><div class="label">学习通已确认</div></div>
    <div class="stat"><div class="num" style="color:var(--gray-text)">${c.bank_only}</div><div class="label">仅题库</div></div>`;
  updateExamInfo();
}

function updateExamInfo() {
  const info = $('#examInfo');
  const modeChecked = document.querySelector('input[name="practiceMode"]:checked');
  const scopeChecked = document.querySelector('input[name="practiceScope"]:checked');
  const scope = scopeChecked ? scopeChecked.value : 'all';
  const mode = modeChecked ? modeChecked.value : 'shuffle';
  const isExam = mode === 'exam';
  const isYihun = mode === 'yihun';
  $('#btnStartPractice').textContent = isExam ? '开始考试' : isYihun ? '开始刷易混' : '开始刷题';
  $('#practiceTitle').textContent = isExam ? '模拟考试' : isYihun ? '刷易混' : '开始刷题';
  $('#yihunBar').classList.toggle('hidden', !isYihun);

  if (isYihun) {
    const n = loadYihun(state.currentCourseId).length;
    info.classList.remove('hidden');
    info.innerHTML = n
      ? `已勾选 <b>${n}</b> 道易混题；开始后只练这些题，选项顺序打乱。`
      : `尚未勾选易混题。点「开始刷易混」会先弹出完整题单供你勾选。`;
    return;
  }

  if (!isExam || !state.practiceQuestions.length) {
    info.classList.add('hidden');
    return;
  }
  const plan = examPlanFor(filterByScope(state.practiceQuestions, scope));
  if (!plan.single && !plan.multiple && !plan.judge) {
    info.classList.remove('hidden');
    info.innerHTML = '该范围内没有可出题的题目。';
    return;
  }
  const parts = [];
  if (plan.single) parts.push(`<b>单选 ${plan.single} 题 × 1 分</b>`);
  if (plan.multiple) parts.push(`<b>多选 ${plan.multiple} 题 × ${formatPoints(plan.perMultiple)} 分</b>`);
  if (plan.judge) parts.push(`<b>判断 ${plan.judge} 题 × 1 分</b>`);
  const notes = [];
  if (plan.multiple && plan.multiple < EXAM_RULES.multiple) {
    notes.push(`本范围多选共 ${plan.multiple} 道，全部抽入，每题 ${formatPoints(plan.perMultiple)} 分（多选合计 40 分）。`);
  }
  if (!plan.single) notes.push('本范围没有单选题。');
  if (!plan.multiple) notes.push('本范围没有多选题。');
  if (!plan.judge) notes.push('本范围没有判断题。');
  info.innerHTML =
    `随机抽题：${parts.join(' · ')}，<span class="exam-total">满分 ${plan.total} 分</span>。` +
    '<br>单选/多选选项顺序随机打乱；考试中不显示对错，交卷后统一评分；多选错选、漏选均不得分。' +
    notes.map(n => '<br>' + n).join('');
  info.classList.remove('hidden');
}

$$('input[name="practiceMode"]').forEach(r => r.addEventListener('change', updateExamInfo));
$$('input[name="practiceScope"]').forEach(r => r.addEventListener('change', updateExamInfo));

$('#btnStartPractice').addEventListener('click', async () => {
  const checked = document.querySelector('input[name="practiceMode"]:checked');
  const mode = checked ? checked.value : 'shuffle';
  const scopeChecked = document.querySelector('input[name="practiceScope"]:checked');
  const scope = scopeChecked ? scopeChecked.value : 'all';

  if (mode === 'yihun') {
    startYihun();
    return;
  }

  if (mode === 'exam') {
    startExam(scope);
    return;
  }

  const data = await api('/api/courses/' + state.currentCourseId + '/practice?mode=' + mode + '&scope=' + scope);
  if (!data.questions.length) {
    return toast(scope === 'verified' ? '该课程没有学习通已确认的题目'
      : scope === 'unverified' ? '该课程没有仅题库的题目' : '题库为空');
  }
  // 乱序模式：题目顺序已打乱，这里再把每题的选项顺序也打乱（判断题保持“正确/错误”固定顺序）
  const questions = mode === 'shuffle' ? data.questions.map(examQuestionCopy) : data.questions;
  state.session = {
    exam: false,
    questions,
    index: 0,
    scope,
    records: questions.map(() => ({ selected: null, skipped: false, guessed: false })),
  };
  $('#practiceStart').classList.add('hidden');
  $('#practiceResult').classList.add('hidden');
  $('#practiceQuiz').classList.remove('hidden');
  window.scrollTo(0, 0);
  renderQuestion();
});

function startExam(scope) {
  const paper = buildExamPaper(filterByScope(state.practiceQuestions, scope));
  if (!paper.questions.length) return toast('该范围内没有可出题的题目');
  state.session = {
    exam: true,
    questions: paper.questions,
    plan: paper.plan,
    index: 0,
    scope,
    records: paper.questions.map(() => ({ selected: null, skipped: false, guessed: false })),
  };
  $('#practiceStart').classList.add('hidden');
  $('#practiceResult').classList.add('hidden');
  $('#practiceQuiz').classList.remove('hidden');
  window.scrollTo(0, 0);
  renderExamQuestion();
}

function currentQuestion() {
  return state.session.questions[state.session.index];
}

function currentRecord() {
  return state.session.records[state.session.index];
}

function recordIsRight(q, r) {
  if (r.skipped || r.guessed) return false;
  if (!r.selected) return false;
  const correctSet = new Set(q.answer);
  return r.selected.length === q.answer.length && r.selected.every(i => correctSet.has(i));
}

function renderFeedback(q, r) {
  const feedback = $('#quizFeedback');
  if (r.skipped) {
    feedback.className = 'feedback wrong';
    feedback.innerHTML = `❓ 已标记为“不清楚”，正确答案：<b>${answerTextWithContent(q)}</b>`;
  } else if (r.guessed) {
    feedback.className = 'feedback wrong';
    feedback.innerHTML = `😅 已标记为“我蒙的”并计入错题，正确答案：<b>${answerTextWithContent(q)}</b>`;
  } else if (recordIsRight(q, r)) {
    feedback.className = 'feedback right';
    feedback.innerHTML = '✅ 回答正确！';
  } else {
    feedback.className = 'feedback wrong';
    let hint = '';
    if (q.type === 'multiple') {
      const correctSet = new Set(q.answer);
      const selectedSet = new Set(r.selected || []);
      const missing = q.answer.filter(i => !selectedSet.has(i));
      const extra = (r.selected || []).filter(i => !correctSet.has(i));
      hint = '（' + (missing.length ? '漏选 ' + missing.map(i => OPT_KEYS[i]).join('') : '') +
             (extra.length ? (missing.length ? '，' : '') + '多选 ' + extra.map(i => OPT_KEYS[i]).join('') : '') + '）';
    }
    feedback.innerHTML = `❌ 回答错误，正确答案：<b>${answerTextWithContent(q)}</b> ${hint}`;
  }
  if (q.explanation) {
    feedback.innerHTML += `<div class="explain"><b>解析：</b>${escapeHtml(q.explanation)}</div>`;
  }
}

function updateQuizButtons(q, r, answered) {
  const s = state.session;
  $('#btnSheet').hidden = true;
  $('#btnSubmitExam').hidden = true;
  $('#btnAddYihun').hidden = !!s.yihun;
  $('#btnPrev').hidden = s.index === 0;
  if (answered) {
    $('#btnSkip').hidden = true;
    $('#btnConfirm').hidden = true;
    $('#btnGuessed').hidden = !(recordIsRight(q, r) && !r.guessed);
    $('#btnNext').hidden = false;
  } else {
    $('#btnSkip').hidden = false;
    $('#btnConfirm').hidden = q.type !== 'multiple';
    $('#btnGuessed').hidden = true;
    $('#btnNext').hidden = true;
  }
  $('#btnNext').textContent = s.index === s.questions.length - 1 ? '查看结果 🎉' : '下一题 →';
}

function renderQuestion() {
  const q = currentQuestion();
  const s = state.session;
  const r = currentRecord();
  const answered = r.selected !== null || r.skipped;

  const typeEl = $('#quizTypeBadge');
  typeEl.className = `badge ${TYPE_BADGE[q.type]}`;
  typeEl.textContent = TYPE_LABEL[q.type];
  $('#quizSourceBadge').innerHTML = sourceBadges(q);
  $('#quizCounter').textContent = `第 ${s.index + 1} / ${s.questions.length} 题`;
  $('#progressBar').style.width = ((s.index) / s.questions.length * 100) + '%';

  const note = $('#quizSourceNote');
  const info = sourceNoteInfo(q);
  note.className = info.cls;
  note.textContent = info.text;

  $('#quizStem').className = 'stem' + (q.verified ? '' : ' unverified-stem');
  let stem = `${s.index + 1}. ` + escapeHtml(q.stem);
  if (q.type === 'multiple') stem += '<span class="hint" style="display:inline-block;margin-left:8px">（多选题）</span>';
  $('#quizStem').innerHTML = stem;

  const optionsEl = $('#quizOptions');
  optionsEl.innerHTML = q.options.map((opt, i) => `
    <div class="option" data-i="${i}">
      <span class="opt-key">${OPT_KEYS[i]}</span>
      <span class="opt-text">${escapeHtml(opt)}</span>
      <span class="opt-mark"></span>
    </div>`).join('');

  const hint = $('#quizHint');
  const feedback = $('#quizFeedback');

  if (answered) {
    const correctSet = new Set(q.answer);
    const selectedSet = new Set(r.selected || []);
    optionsEl.querySelectorAll('.option').forEach(opt => {
      const i = parseInt(opt.dataset.i);
      opt.classList.add('locked');
      if (correctSet.has(i)) opt.classList.add('correct');
      else if (selectedSet.has(i)) opt.classList.add('wrong');
      else opt.classList.add('dim');
    });
    hint.classList.add('hidden');
    renderFeedback(q, r);
  } else {
    feedback.className = 'feedback hidden';
    feedback.innerHTML = '';
    hint.textContent = q.type === 'multiple' ? '可选择多个答案，选好后点“确认答案”' : '点击选项即可作答';
    hint.classList.remove('hidden');
    optionsEl.querySelectorAll('.option').forEach(opt => {
      opt.addEventListener('click', () => {
        const r2 = currentRecord();
        if (r2.selected !== null || r2.skipped) return;
        if (q.type === 'multiple') {
          opt.classList.toggle('selected');
        } else {
          submitAnswer([parseInt(opt.dataset.i)]);
        }
      });
    });
  }

  updateQuizButtons(q, r, answered);
}

/* ---------- 模拟考试作答 ---------- */
function renderExamQuestion() {
  const s = state.session;
  const q = s.questions[s.index];
  const r = s.records[s.index];
  const answeredCount = s.records.filter(x => x.selected !== null).length;

  const typeEl = $('#quizTypeBadge');
  typeEl.className = `badge ${TYPE_BADGE[q.type]}`;
  typeEl.textContent = TYPE_LABEL[q.type];
  const points = q.type === 'multiple' ? s.plan.perMultiple : 1;
  $('#quizSourceBadge').innerHTML = `<span class="badge bank">本题 ${formatPoints(points)} 分</span>`;
  $('#quizCounter').textContent = `第 ${s.index + 1} / ${s.questions.length} 题 · 已答 ${answeredCount}`;
  $('#progressBar').style.width = ((s.index) / s.questions.length * 100) + '%';

  const note = $('#quizSourceNote');
  note.className = 'source-note hidden';
  note.textContent = '';

  $('#quizStem').className = 'stem';
  let stem = `${s.index + 1}. ` + escapeHtml(q.stem);
  if (q.type === 'multiple') stem += '<span class="hint" style="display:inline-block;margin-left:8px">（多选题）</span>';
  $('#quizStem').innerHTML = stem;

  const selected = new Set(r.selected || []);
  const optionsEl = $('#quizOptions');
  optionsEl.innerHTML = q.options.map((opt, i) => `
    <div class="option ${selected.has(i) ? 'selected' : ''}" data-i="${i}">
      <span class="opt-key">${OPT_KEYS[i]}</span>
      <span class="opt-text">${escapeHtml(opt)}</span>
      <span class="opt-mark"></span>
    </div>`).join('');
  optionsEl.querySelectorAll('.option').forEach(opt => {
    opt.addEventListener('click', () => toggleExamOption(parseInt(opt.dataset.i)));
  });

  const hint = $('#quizHint');
  hint.textContent = q.type === 'multiple'
    ? '多选题：可选择多个选项，再次点击可取消；交卷后统一评分，错选、漏选均不得分'
    : '点击选项作答，可随时修改；交卷后统一评分';
  hint.classList.remove('hidden');

  const feedback = $('#quizFeedback');
  feedback.className = 'feedback hidden';
  feedback.innerHTML = '';

  updateExamButtons();
}

function toggleExamOption(i) {
  const s = state.session;
  const q = s.questions[s.index];
  const r = s.records[s.index];
  if (q.type === 'multiple') {
    const set = new Set(r.selected || []);
    if (set.has(i)) set.delete(i); else set.add(i);
    r.selected = set.size ? Array.from(set).sort((a, b) => a - b) : null;
  } else {
    r.selected = [i];
  }
  renderExamQuestion();
}

function updateExamButtons() {
  const s = state.session;
  $('#btnSkip').hidden = true;
  $('#btnConfirm').hidden = true;
  $('#btnGuessed').hidden = true;
  $('#btnAddYihun').hidden = false;
  $('#btnSheet').hidden = false;
  $('#btnSubmitExam').hidden = false;
  $('#btnPrev').hidden = s.index === 0;
  $('#btnNext').hidden = false;
  $('#btnNext').textContent = s.index === s.questions.length - 1 ? '完成并交卷' : '下一题 →';
}

function openSheet(mode = 'exam') {
  const s = state.session;
  if (!s || !s.exam) return;
  const review = mode === 'review';
  const total = s.questions.length;
  const answered = s.records.filter(r => r.selected !== null).length;
  const rightCount = review
    ? s.questions.filter((q, i) => recordIsRight(q, s.records[i])).length
    : 0;

  if (review) {
    $('#sheetSummary').innerHTML =
      `答对 <b style="color:var(--green)">${rightCount}</b> 题 · 答错 <b style="color:var(--red)">${total - rightCount}</b> 题` +
      `<div class="sheet-hint">绿色为答对，红色为答错或未答；点击题号查看该题的作答详情。</div>`;
  } else {
    $('#sheetSummary').innerHTML = `已答 <b>${answered}</b> / ${total} 题` +
      (answered < total ? `，还有 <b>${total - answered}</b> 题未答` : '，全部作答完毕');
  }

  const sections = [['single', '单选题'], ['multiple', '多选题'], ['judge', '判断题']];
  $('#sheetBody').innerHTML = sections.map(([key, label]) => {
    const idxs = s.questions.map((q, i) => (q.type === key ? i : -1)).filter(i => i >= 0);
    if (!idxs.length) return '';
    const done = idxs.filter(i => s.records[i].selected !== null).length;
    const doneText = review
      ? `${idxs.filter(i => recordIsRight(s.questions[i], s.records[i])).length}/${idxs.length} 答对`
      : `${done}/${idxs.length} 已答`;
    const cells = idxs.map(i => {
      const isRight = review && recordIsRight(s.questions[i], s.records[i]);
      const cls = [
        'sheet-cell',
        review ? (isRight ? 'correct' : 'wrong') : (s.records[i].selected !== null ? 'answered' : ''),
        !review && i === s.index ? 'current' : '',
      ].filter(Boolean).join(' ');
      return `<button class="${cls}" data-i="${i}">${i + 1}</button>`;
    }).join('');
    return `<div class="sheet-group">
      <div class="sheet-group-head"><b>${label}</b><span>${doneText}</span></div>
      <div class="sheet-grid">${cells}</div>
    </div>`;
  }).join('');

  $('#sheetBody').querySelectorAll('.sheet-cell').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.i);
      if (review) {
        renderSheetDetail(i, btn);
        return;
      }
      s.index = i;
      closeSheet();
      renderExamQuestion();
      window.scrollTo(0, 0);
    });
  });

  $('#sheetDetail').classList.add('hidden');
  $('#sheetDetail').innerHTML = '';
  $('#btnResumeExam').textContent = review ? '关闭' : '继续答题';
  $('#btnSubmitSheet').hidden = review;
  $('#sheetModal').classList.remove('hidden');
  $('#sheetModal .modal-body').scrollTop = 0;
}

function renderSheetDetail(i, cell) {
  const s = state.session;
  const q = s.questions[i];
  const r = s.records[i];
  const right = recordIsRight(q, r);
  const selected = new Set(r.selected || []);
  const points = q.type === 'multiple' ? s.plan.perMultiple : 1;

  const opts = q.options.map((text, j) => {
    const isCorrect = q.answer.includes(j);
    const picked = selected.has(j);
    const cls = isCorrect ? 'correct' : picked ? 'wrong' : 'dim';
    const mark = isCorrect ? '✓' : picked ? '✗' : '';
    return `<div class="sd-opt ${cls}">
      <span class="sd-key">${OPT_KEYS[j]}</span>
      <span>${escapeHtml(text)}</span>
      <span class="sd-mark">${mark}</span>
    </div>`;
  }).join('');

  let yourText;
  if (r.selected && r.selected.length) {
    yourText = q.type === 'judge'
      ? (r.selected[0] === 0 ? '正确' : '错误')
      : r.selected.map(x => `${OPT_KEYS[x]}.${q.options[x] || ''}`).join('、');
  } else {
    yourText = '（未作答）';
  }

  const el = $('#sheetDetail');
  el.innerHTML = `
    <div class="sd-head">
      <span class="badge ${TYPE_BADGE[q.type]}">${TYPE_LABEL[q.type]}</span>
      <span class="badge ${right ? 'ok' : 'bad'}">${right ? '答对' : '答错'}</span>
      <span class="sd-score">得分 ${right ? formatPoints(points) : 0} / ${formatPoints(points)}</span>
    </div>
    <div class="sd-stem">${i + 1}. ${escapeHtml(q.stem)}</div>
    <div class="sd-options">${opts}</div>
    <div class="sd-answer">
      你的答案：<b class="${right ? 'ok' : 'bad'}">${escapeHtml(yourText)}</b>
      　｜　正确答案：<b class="ok">${answerTextWithContent(q)}</b>
      ${q.explanation ? '<div class="sd-explain">解析：' + escapeHtml(q.explanation) + '</div>' : ''}
    </div>`;
  el.classList.remove('hidden');
  $$('#sheetBody .sheet-cell').forEach(c => c.classList.toggle('active', c === cell));
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeSheet() {
  $('#sheetModal').classList.add('hidden');
}

function submitExam() {
  const s = state.session;
  if (!s || !s.exam) return;
  const unanswered = s.records.filter(r => r.selected === null).length;
  if (unanswered && !confirm(`还有 ${unanswered} 题未作答，确定交卷吗？未作答按错误计分。`)) return;
  closeSheet();
  showExamResult();
}

function showExamResult() {
  const s = state.session;
  window.scrollTo(0, 0);
  $('#practiceQuiz').classList.add('hidden');
  const resultEl = $('#practiceResult');
  resultEl.classList.remove('hidden');

  const perType = { single: { total: 0, right: 0 }, multiple: { total: 0, right: 0 }, judge: { total: 0, right: 0 } };
  const wrongItems = [];
  let score = 0;
  s.questions.forEach((q, i) => {
    perType[q.type].total++;
    if (recordIsRight(q, s.records[i])) {
      perType[q.type].right++;
      score += q.type === 'multiple' ? s.plan.perMultiple : 1;
    } else {
      wrongItems.push({ q, r: s.records[i] });
    }
  });
  score = Math.round(score * 10) / 10;
  const multiScore = Math.round(perType.multiple.right * s.plan.perMultiple * 10) / 10;

  $('#resultTitle').textContent = '📝 考试结束';
  $('#resultScore').innerHTML = `${formatPoints(score)} <small>/ ${s.plan.total} 分</small>`;
  $('#resultStats').innerHTML = [
    `<div class="stat"><div class="num">${perType.single.right}/${perType.single.total}</div><div class="label">单选 · ${perType.single.right} 分</div></div>`,
    `<div class="stat"><div class="num">${perType.multiple.right}/${perType.multiple.total}</div><div class="label">多选 · ${formatPoints(multiScore)} 分</div></div>`,
    `<div class="stat"><div class="num">${perType.judge.right}/${perType.judge.total}</div><div class="label">判断 · ${perType.judge.right} 分</div></div>`,
  ].join('');

  const wrongEl = $('#resultWrong');
  if (!wrongItems.length) {
    wrongEl.innerHTML = '<div class="empty">全部答对，满分！🎉</div>';
  } else {
    wrongEl.innerHTML = `<h3>错题回顾（${wrongItems.length} 题）</h3>` + wrongItems.map(({ q, r }, i) => {
      const yourText = r.selected && r.selected.length
        ? q.type === 'judge'
          ? (r.selected[0] === 0 ? '正确' : '错误')
          : r.selected.map(x => `${OPT_KEYS[x]}.${q.options[x] || ''}`).join('、')
        : '（未作答）';
      return `
      <div class="wr-item ${q.verified ? '' : 'unverified'}">
        <div class="q-meta">${typeBadge(q.type)} ${sourceBadges(q)}</div>
        <div class="wr-stem">${i + 1}. ${escapeHtml(q.stem)}</div>
        <div class="wr-detail">
          你的答案：${escapeHtml(yourText)}
          ｜ 正确答案：<b style="color:#16a34a">${answerTextWithContent(q)}</b>
          ${q.explanation ? '<br>解析：' + escapeHtml(q.explanation) : ''}
        </div>
      </div>`;
    }).join('');
  }
  $('#btnAgain').textContent = '再考一次';
  $('#btnReviewSheet').hidden = false;
}

$('#btnConfirm').addEventListener('click', () => {
  const r = currentRecord();
  if (r.selected !== null || r.skipped) return;
  const selected = $$('#quizOptions .option.selected').map(o => parseInt(o.dataset.i));
  if (!selected.length) return toast('请先选择答案');
  submitAnswer(selected);
});

$('#btnSkip').addEventListener('click', () => {
  const r = currentRecord();
  if (r.selected !== null || r.skipped) return;
  r.skipped = true;
  renderQuestion();
});

$('#btnGuessed').addEventListener('click', () => {
  const r = currentRecord();
  if (r.guessed) return;
  r.guessed = true;
  renderQuestion();
});

$('#btnPrev').addEventListener('click', () => {
  const s = state.session;
  if (s.index > 0) {
    s.index--;
    if (s.exam) {
      renderExamQuestion();
      window.scrollTo(0, 0);
    } else {
      renderQuestion();
    }
  }
});

$('#btnSheet').addEventListener('click', () => openSheet('exam'));
$('#btnReviewSheet').addEventListener('click', () => openSheet('review'));
$('#btnSubmitExam').addEventListener('click', submitExam);
$('#btnCloseSheet').addEventListener('click', closeSheet);
$('#btnResumeExam').addEventListener('click', closeSheet);
$('#btnSubmitSheet').addEventListener('click', submitExam);

function submitAnswer(selected) {
  const r = currentRecord();
  if (r.selected !== null || r.skipped) return;
  r.selected = selected;
  renderQuestion();
}

$('#btnNext').addEventListener('click', () => {
  const s = state.session;
  if (s.exam) {
    if (s.index >= s.questions.length - 1) submitExam();
    else {
      s.index++;
      renderExamQuestion();
      window.scrollTo(0, 0);
    }
    return;
  }
  if (s.index >= s.questions.length - 1) {
    showResult();
  } else {
    s.index++;
    renderQuestion();
  }
});

function showResult() {
  const s = state.session;
  window.scrollTo(0, 0);
  $('#practiceQuiz').classList.add('hidden');
  const resultEl = $('#practiceResult');
  resultEl.classList.remove('hidden');

  const total = s.questions.length;
  const perType = { single: { total: 0, right: 0 }, multiple: { total: 0, right: 0 }, judge: { total: 0, right: 0 } };
  const wrongItems = [];
  let right = 0;
  s.questions.forEach((q, i) => {
    perType[q.type].total++;
    if (recordIsRight(q, s.records[i])) {
      perType[q.type].right++;
      right++;
    } else {
      wrongItems.push({ q, r: s.records[i] });
    }
  });
  const accuracy = total ? Math.round(right / total * 100) : 0;

  $('#resultTitle').textContent = '🎉 刷题完成';
  $('#btnAgain').textContent = '再刷一次';
  $('#btnReviewSheet').hidden = true;
  $('#resultScore').innerHTML = `${right} <small>/ ${total} 题 · 正确率 ${accuracy}%</small>`;
  $('#resultStats').innerHTML = ['single', 'multiple', 'judge'].map(t => {
    const p = perType[t];
    return `<div class="stat"><div class="num">${p.right}/${p.total}</div><div class="label">${TYPE_LABEL[t]}</div></div>`;
  }).join('');

  const wrongEl = $('#resultWrong');
  if (!wrongItems.length) {
    wrongEl.innerHTML = '<div class="empty">全部答对，太棒了！🎉</div>';
  } else {
    wrongEl.innerHTML = `<h3>错题回顾（${wrongItems.length} 题）</h3>` + wrongItems.map(({ q, r }, i) => {
      let yourText;
      if (r.skipped) {
        yourText = '不清楚';
      } else if (r.selected && r.selected.length) {
        yourText = q.type === 'judge'
          ? (r.selected[0] === 0 ? '正确' : '错误')
          : r.selected.map(x => `${OPT_KEYS[x]}.${q.options[x] || ''}`).join('、');
      } else {
        yourText = '（未选）';
      }
      const guessedTag = r.guessed ? '（我蒙的）' : '';
      return `
      <div class="wr-item ${q.verified ? '' : 'unverified'}">
        <div class="q-meta">${typeBadge(q.type)} ${sourceBadges(q)}</div>
        <div class="wr-stem">${i + 1}. ${escapeHtml(q.stem)}</div>
        <div class="wr-detail">
          你的答案：${escapeHtml(yourText)}${guessedTag}
          ｜ 正确答案：<b style="color:#16a34a">${answerTextWithContent(q)}</b>
          ${q.explanation ? '<br>解析：' + escapeHtml(q.explanation) : ''}
        </div>
      </div>`;
    }).join('');
  }
}

$('#btnAgain').addEventListener('click', () => $('#btnStartPractice').click());
$('#btnBackPractice').addEventListener('click', () => loadPracticeStart());

/* ========== 转义 ========== */
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* ========== 静态版 Service Worker ========== */
function registerServiceWorker() {
  if (!STATIC || !('serviceWorker' in navigator)) return;
  if (!/^https?:$/.test(location.protocol)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

/* ========== 初始化 ========== */
async function init() {
  document.body.classList.toggle('static-mode', STATIC);
  if (STATIC) {
    $('#coursesTitle').textContent = '选择题库';
    $('#coursesSub').textContent = '点一套题库开始刷题；灰色题目为仅题库出现、答案未经学习通验证的题。';
    $('#navCourses').textContent = '📚 题库';
    $('#bankTitleText').textContent = '题库（只读）';
  }
  try {
    await loadCourses();
  } catch (e) {
    console.error(e);
  }
  switchView('courses');
  renderOptionEditor();
  registerServiceWorker();
}

init();
