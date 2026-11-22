/* ========== 全局状态 ========== */
const STATIC_DATA = window.__STATIC_DATA__ || null;
const STATIC = !!STATIC_DATA;
const STATIC_BANKS = STATIC ? (STATIC_DATA.banks || {}) : {};
const COURSE_WORD = STATIC ? '题库' : '课程';

const state = {
  courses: [],
  currentCourseId: localStorage.getItem('currentCourseId') || null,
  questions: [],
  bankFilter: 'all',
  // 刷题会话
  session: null,      // { questions: [], index: 0, rightCount, perType }
  answered: false,
};

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

/* ========== 刷题 ========== */
async function loadPracticeStart() {
  const start = $('#practiceStart'), quiz = $('#practiceQuiz'), result = $('#practiceResult');
  quiz.classList.add('hidden'); result.classList.add('hidden');
  if (!state.currentCourseId) {
    start.classList.remove('hidden');
    $('#practiceCourseName').textContent = '';
    $('#practiceStats').innerHTML = `<div class="empty">请先在“${STATIC ? '题库' : '课程'}”页选择${COURSE_WORD}。</div>`;
    return;
  }
  const course = state.courses.find(c => c.id === state.currentCourseId);
  const data = await api('/api/courses/' + state.currentCourseId + '/practice');
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
}

$('#btnStartPractice').addEventListener('click', async () => {
  const checked = document.querySelector('input[name="practiceMode"]:checked');
  const mode = checked ? checked.value : 'shuffle';
  const scopeChecked = document.querySelector('input[name="practiceScope"]:checked');
  const scope = scopeChecked ? scopeChecked.value : 'all';
  const data = await api('/api/courses/' + state.currentCourseId + '/practice?mode=' + mode + '&scope=' + scope);
  if (!data.questions.length) {
    return toast(scope === 'verified' ? '该课程没有学习通已确认的题目'
      : scope === 'unverified' ? '该课程没有仅题库的题目' : '题库为空');
  }
  state.session = {
    questions: data.questions,
    index: 0,
    rightCount: 0,
    scope,
    perType: { single: { total: 0, right: 0 }, multiple: { total: 0, right: 0 }, judge: { total: 0, right: 0 } },
    wrong: [],
  };
  data.questions.forEach(q => state.session.perType[q.type].total++);
  $('#practiceStart').classList.add('hidden');
  $('#practiceResult').classList.add('hidden');
  $('#practiceQuiz').classList.remove('hidden');
  renderQuestion();
});

function currentQuestion() {
  return state.session.questions[state.session.index];
}

function renderQuestion() {
  const q = currentQuestion();
  const s = state.session;
  state.answered = false;

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
  feedback.className = 'feedback hidden';
  feedback.innerHTML = '';
  $('#btnConfirm').hidden = (q.type !== 'multiple');
  $('#btnNext').hidden = true;

  optionsEl.querySelectorAll('.option').forEach(opt => {
    opt.addEventListener('click', () => {
      if (state.answered) return;
      if (q.type === 'multiple') {
        opt.classList.toggle('selected');
      } else {
        submitAnswer([parseInt(opt.dataset.i)]);
      }
    });
  });

  hint.textContent = q.type === 'multiple' ? '可选择多个答案，选好后点“确认答案”' : '点击选项即可作答';
  hint.classList.remove('hidden');
}

$('#btnConfirm').addEventListener('click', () => {
  if (state.answered) return;
  const selected = $$('#quizOptions .option.selected').map(o => parseInt(o.dataset.i));
  if (!selected.length) return toast('请先选择答案');
  submitAnswer(selected);
});

function submitAnswer(selected) {
  const q = currentQuestion();
  state.answered = true;

  const correctSet = new Set(q.answer);
  const selectedSet = new Set(selected);
  const isRight = selected.length === q.answer.length && selected.every(i => correctSet.has(i));

  // 渲染反馈
  $$('#quizOptions .option').forEach(opt => {
    const i = parseInt(opt.dataset.i);
    opt.classList.add('locked');
    if (correctSet.has(i)) opt.classList.add('correct');
    else if (selectedSet.has(i)) opt.classList.add('wrong');
    else opt.classList.add('dim');
  });

  const feedback = $('#quizFeedback');
  if (isRight) {
    state.session.rightCount++;
    state.session.perType[q.type].right++;
    feedback.className = 'feedback right';
    feedback.innerHTML = '✅ 回答正确！';
  } else {
    state.session.wrong.push({ q, your: selected });
    feedback.className = 'feedback wrong';
    let hint = '';
    if (q.type === 'multiple') {
      const missing = q.answer.filter(i => !selectedSet.has(i));
      const extra = selected.filter(i => !correctSet.has(i));
      hint = '（' + (missing.length ? '漏选 ' + missing.map(i => OPT_KEYS[i]).join('') : '') +
             (extra.length ? (missing.length ? '，' : '') + '多选 ' + extra.map(i => OPT_KEYS[i]).join('') : '') + '）';
    }
    feedback.innerHTML = `❌ 回答错误，正确答案：<b>${answerTextWithContent(q)}</b> ${hint}`;
  }
  if (q.explanation) {
    feedback.innerHTML += `<div class="explain"><b>解析：</b>${escapeHtml(q.explanation)}</div>`;
  }

  $('#btnConfirm').hidden = true;
  const nextBtn = $('#btnNext');
  nextBtn.hidden = false;
  nextBtn.textContent = state.session.index === state.session.questions.length - 1 ? '查看结果 🎉' : '下一题 →';
}

$('#btnNext').addEventListener('click', () => {
  const s = state.session;
  if (s.index >= s.questions.length - 1) {
    showResult();
  } else {
    s.index++;
    renderQuestion();
  }
});

function showResult() {
  const s = state.session;
  $('#practiceQuiz').classList.add('hidden');
  const resultEl = $('#practiceResult');
  resultEl.classList.remove('hidden');

  const total = s.questions.length;
  const right = s.rightCount;
  const accuracy = total ? Math.round(right / total * 100) : 0;

  $('#resultScore').innerHTML = `${right} <small>/ ${total} 题 · 正确率 ${accuracy}%</small>`;
  $('#resultStats').innerHTML = ['single', 'multiple', 'judge'].map(t => {
    const p = s.perType[t];
    return `<div class="stat"><div class="num">${p.right}/${p.total}</div><div class="label">${TYPE_LABEL[t]}</div></div>`;
  }).join('');

  const wrongEl = $('#resultWrong');
  if (!s.wrong.length) {
    wrongEl.innerHTML = '<div class="empty">全部答对，太棒了！🎉</div>';
  } else {
    wrongEl.innerHTML = `<h3>错题回顾（${s.wrong.length} 题）</h3>` + s.wrong.map((w, i) => `
      <div class="wr-item ${w.q.verified ? '' : 'unverified'}">
        <div class="q-meta">${typeBadge(w.q.type)} ${sourceBadges(w.q)}</div>
        <div class="wr-stem">${i + 1}. ${escapeHtml(w.q.stem)}</div>
        <div class="wr-detail">
          ${w.q.type === 'judge'
            ? `你的答案：${w.your[0] === 0 ? '正确' : '错误'}`
            : `你的答案：${w.your.map(x => OPT_KEYS[x]).join('') || '（未选）'}`}
          ｜ 正确答案：<b style="color:#16a34a">${answerText(w.q)}</b>
          ${w.q.explanation ? '<br>解析：' + escapeHtml(w.q.explanation) : ''}
        </div>
      </div>`).join('');
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
