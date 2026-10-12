(() => {
  const translations = {
    "All downloads": "كل التنزيلات",
    "Windows": "ويندوز",
    "Linux": "لينكس",
    "Installer (.exe)": "المثبّت (.exe)",
    "Portable (.exe)": "النسخة المحمولة (.exe)",
    "Disk image (.dmg)": "ملف التثبيت (.dmg)",
    "Debian / Ubuntu (.deb)": "ديبيان / أوبونتو (.deb)",
    "Download for Linux": "تنزيل لنظام لينكس",
    "Missing a package? Check the release assets.": "لم تجد الحزمة؟ راجع ملفات الإصدار.",
    "x64 · AppImage or Debian / Ubuntu package.": "x64 · ملف AppImage أو حزمة ديبيان / أوبونتو.",
    "Linux packages appear here after the first Linux release. If a package is unavailable, the link opens the latest release.": "تظهر حزم لينكس هنا بعد نشر أول إصدار له. إذا لم تتوفر الحزمة، يفتح الرابط أحدث إصدار.",
    ", Windows 10/11 x64, Apple Silicon Mac and Linux x64. Free under the MIT licence.": "، لويندوز 10/11 بمعمارية x64 وماك بمعالج Apple Silicon ولينكس x64. مجاني برخصة MIT.",
    "Windows 10 or 11 (x64), an Apple Silicon Mac with macOS 13 or later, or Linux (x64). Install the agent CLIs you want to use: Claude Code, Codex CLI, Gemini CLI. Node.js 20+ is only needed to install Codex and Gemini from inside Dawsha.": "ويندوز 10 أو 11 بمعمارية x64، أو ماك بمعالج Apple Silicon وmacOS 13 أو أحدث، أو لينكس بمعمارية x64. ثبّت أدوات الوكلاء التي تريدها: Claude Code وCodex CLI وGemini CLI. تحتاج Node.js 20+ فقط لتثبيت Codex وGemini من داخل دوشة.",
    'Find and resume sessions': 'ابحث عن الجلسات واستأنفها',
    'Ctrl+Shift+R searches prompts and replies. Choose the current project or include all projects.': 'ابحث في الأسئلة والردود باستخدام Ctrl+Shift+R. اختر المشروع الحالي أو جميع المشاريع.',
    'Keep closed sessions': 'احتفظ بالجلسات المغلقة',
    'Closed tabs stay under their project until you remove them there. Resume one whenever you need it.': 'تبقى الألسنة المغلقة تحت مشروعها حتى تزيلها منه. يمكنك استئنافها وقتما تشاء.',
    'Project tasks': 'مهام المشروع',
    'Keep a task timeline with notes, commit references and linked sessions.': 'احتفظ بسجل للمهمة يتضمن الملاحظات ومراجع الالتزامات والجلسات المرتبطة.',
    'Gemini tool activity': 'نشاط أدوات Gemini',
    "See Gemini's recent tools beside its session and in the agents drawer.": 'اطّلع على أحدث أدوات Gemini بجوار مساحته وفي لوحة الوكلاء.',
    'Skip to content': 'انتقل إلى المحتوى',
    'Screens': 'صور التطبيق', 'Features': 'المميزات', 'Command': 'سطر الأوامر', 'Download': 'التحميل',
    'For Claude Code, Codex CLI and Gemini CLI': 'لـ Claude Code وCodex CLI وGemini CLI',
    'Every AI coding agent, one readable window.': 'كل وكلاء البرمجة بالذكاء الاصطناعي في نافذة واحدة واضحة.',
    'Run Claude Code, Codex and Gemini side by side in large, readable terminals, one session per task.': 'شغّل Claude Code وCodex وGemini جنبًا إلى جنب في طرفيات واسعة وواضحة، مع مساحة مستقلة لكل مهمة.',
    'Download for Windows': 'حمّل لويندوز', 'Portable version': 'النسخة المحمولة',
    'Apple Silicon Mac': 'ماك بمعالج Apple Silicon',
    'macOS 13 or later · ARM64 DMG · Drag Dawsha to Applications.': 'macOS 13 أو أحدث · ملف DMG بمعمارية ARM64 · اسحب دوشة إلى التطبيقات.',
    'Download for Mac': 'تنزيل لنظام Mac',
    'Works with': 'يعمل مع',
    'Your own installs and sign-ins. Dawsha never handles credentials.': 'استخدم تثبيتاتك وحساباتك الحالية. دوشة لا تتعامل مع كلمات المرور.',
    'See it work': 'شاهد التطبيق', 'Real screenshots from the app, with sample projects.': 'صور حقيقية من التطبيق بمشاريع تجريبية.',
    'Resume anything.': 'أكمل من حيث توقفت.',
    'One list of earlier sessions across all three agents, with search and a preview.': 'كل جلسات الوكلاء الثلاثة في قائمة واحدة، مع البحث والمعاينة.',
    'Command palette.': 'لوحة الأوامر.',
    'Ctrl+K reaches sessions, projects, snippets and layouts from the keyboard.': 'اختصار Ctrl+K يوصلك إلى الجلسات والمشاريع والمقاطع والتخطيطات.',
    'Ask two agents.': 'اسأل وكيلين.',
    'Same prompt, two answers, each in its own git worktree. Keep one, both, or diff.': 'نفس السؤال وإجابتان في مساحتي عمل منفصلتين. احتفظ بإحداهما أو كلتيهما أو قارن الفروق.',
    'Usage.': 'الاستخدام.',
    'Tokens per day, cost where an agent reports one, and your 5 hour and weekly limits.': 'الرموز يوميًا، والتكلفة حين يتيحها الوكيل، وحدود الخمس ساعات والأسبوع.',
    'Skills.': 'المهارات.', 'Find, open, copy and export skills installed for each agent.': 'ابحث عن المهارات المثبتة لكل وكيل وافتحها وانسخ مساراتها أو صدّرها.',
    'Installed agents.': 'الوكلاء المثبتون.', 'Browse and export your agent definitions, including project agents.': 'تصفح تعريفات وكلائك وصدّرها، بما فيها وكلاء المشاريع.',
    'Built for running several agents at once': 'مصمم لتشغيل عدة وكلاء في وقت واحد',
    'Activity at a glance.': 'النشاط أمامك.',
    'Native processes and optional Claude sub-agent progress sit beside each session.': 'العمليات الجارية، وتقدم الوكلاء الفرعيين في Claude عند توفره، بجانب كل مساحة.',
    'Run': 'شغّل', 'Switch': 'تنقّل', 'Stay informed': 'تابع كل شيء',
    'Three agents in one grid': 'ثلاثة وكلاء في شبكة واحدة',
    'Up to 6 real terminals. Resize, drag, pin or maximize any session, Ctrl+Tab between them.': 'حتى ٦ طرفيات حقيقية. غيّر الحجم، واسحب وثبّت وكبّر أي مساحة، وتنقّل بينها بـ Ctrl+Tab.',
    'The dawsha command': 'أمر dawsha',
    'Start, resume and open layouts from the terminal you already use.': 'ابدأ الجلسات واستأنفها وافتح التخطيطات من طرفيتك المعتادة.',
    'Commit and push': 'احفظ التغييرات وارفعها',
    'Review the changed files, commit the ones you pick or commit and push. Pull, switch branch and stash in a click.': 'راجع الملفات المتغيرة واختر ما تريد حفظه أو رفعه. اسحب التحديثات وبدّل الفروع واحفظ العمل مؤقتًا بنقرة.',
    'Layouts, snippets, instructions': 'التخطيطات والمقاطع والتعليمات',
    'Restore a setup by name, insert snippets, and keep CLAUDE.md, AGENTS.md and GEMINI.md in sync.': 'استعد ترتيبك المحفوظ، وأدرج المقاطع، وأبقِ ملفات تعليمات الوكلاء متناسقة.',
    'Import existing settings': 'استيراد إعدادات سابقة', 'Bring in projects and preferences from an earlier setup, with a backup of your current Dawsha settings.': 'انقل مشاريعك وتفضيلاتك من إعداد سابق مع الاحتفاظ بنسخة احتياطية من إعدادات دوشة الحالية.',
    'Themes': 'السمات', 'Eight themes with contrast checks and an optional background image.': 'ثماني سمات واضحة مع خيار إضافة صورة خلفية.',
    'Installed skills': 'المهارات المثبتة', 'Browse, open, copy and export skills for every agent, including project skills.': 'تصفح مهارات كل وكيل، بما فيها مهارات المشاريع، وافتحها وانسخها أو صدّرها.',
    'Resume any session': 'استأنف أي جلسة', 'Ctrl+Shift+R lists earlier sessions of all three agents.': 'يعرض Ctrl+Shift+R الجلسات السابقة لكل الوكلاء.',
    'Command palette': 'لوحة الأوامر', 'Ctrl+K finds sessions, projects, snippets and layouts.': 'ابحث عن الجلسات والمشاريع والمقاطع والتخطيطات بـ Ctrl+K.',
    'Find and copy': 'ابحث وانسخ',
    'Search any terminal, open files in their matching apps, and copy the last reply or the prompt you are typing.': 'ابحث داخل أي مساحة، وافتح الملفات في التطبيق المناسب، وانسخ آخر رد أو سؤالك الجاري.',
    'Ask two agents': 'اسأل وكيلين', 'One prompt, two worktrees, two answers to compare.': 'سؤال واحد ومساحتا عمل وإجابتان للمقارنة.',
    'Continue in another agent': 'أكمل مع وكيل آخر', 'Hand a session over with an editable summary, or export it as Markdown.': 'انقل الجلسة مع ملخص قابل للتعديل، أو صدّرها بصيغة Markdown.',
    'Needs-you alerts': 'تنبيهات تحتاج تدخلك', 'An amber border and a notification when a session needs your input.': 'إطار كهرماني وتنبيه عندما تنتظر إحدى المساحات ردك.',
    'Highlights and context': 'التمييز والسياق', 'Errors stand out, and a nearly full session warns you before it runs out.': 'الأخطاء واضحة، ويُنبهك التطبيق قبل امتلاء سياق الجلسة.',
    'Reset countdowns': 'العد التنازلي لتجديد الحدود', 'Claude sessions show the 5-hour and weekly reset countdowns when Claude reports them.': 'تعرض مساحات Claude الوقت المتبقي لتجديد حدود الخمس ساعات والأسبوع عندما يوفّر Claude وقت التجديد.',
    'Cost and usage': 'التكلفة والاستخدام', 'Time, tokens and cost for every session, plus a full usage view.': 'الوقت والرموز والتكلفة لكل مساحة، مع صفحة كاملة للاستخدام.',
    'In-app updates': 'التحديث داخل التطبيق', 'The installed build updates itself while sessions keep running.': 'تتحدث النسخة المثبتة دون إيقاف جلساتك الجارية.',
    'Everything local': 'كل شيء على جهازك', 'No account and no telemetry. Nothing leaves your machine.': 'بلا حساب وبلا تتبع. بياناتك تبقى على جهازك.',
    'How it works': 'كيف يعمل', 'Install': 'ثبّت',
    'Run the installer or the portable exe. Sign in once to each agent CLI you use, in any terminal.': 'شغّل المثبّت أو النسخة المحمولة. سجّل الدخول إلى أدوات الوكلاء التي تستخدمها مرة واحدة.',
    'Add projects': 'أضف مشاريعك', 'Pick a folder and a default agent. A short first-run setup shows which CLIs it found.': 'اختر مجلدًا ووكيلًا افتراضيًا. يوضح الإعداد الأولي الأدوات التي وجدها التطبيق.',
    'Start sessions': 'ابدأ الجلسات', 'Press Ctrl+N, or run': 'اضغط Ctrl+N أو شغّل', 'in a folder. Each agent runs in its own terminal.': 'داخل مجلد. يعمل كل وكيل في مساحته الخاصة.',
    'Stay on top': 'ابقَ على اطلاع', 'Glance at status, plans and context. Come back when a session needs your input.': 'تابع الحالة والخطط والسياق، وعد عندما تحتاج إحدى المساحات إليك.',
    'The': 'أمر', 'command': '',
    'The installer adds it to your PATH. Open a new terminal and drive Dawsha from where you already work.': 'يضيفه المثبّت إلى PATH. افتح طرفية جديدة وتحكم في دوشة من مكان عملك المعتاد.',
    'Download Dawsha': 'حمّل دوشة', 'Latest release': 'أحدث إصدار',
    ', Windows 10/11 x64 and Apple Silicon Mac. Free under the MIT licence.': '، لويندوز 10/11 بمعمارية x64 وMac بمعالج Apple Silicon. مجاني برخصة MIT.',
    'Installer': 'المثبّت', 'Recommended': 'موصى به', 'Adds the': 'يضيف أمر', 'command to your PATH and updates itself.': 'إلى PATH ويتحدث تلقائيًا.',
    'Portable': 'محمول', 'One exe, no install, no PATH changes. Does not update itself.': 'ملف تشغيل واحد دون تثبيت أو تغيير PATH. لا يتحدث تلقائيًا.',
    'SmartScreen.': 'حماية ويندوز.',
    'The builds are not code signed, so Windows may show "Windows protected your PC". Choose': 'الإصدارات غير موقّعة رقميًا، لذلك قد يعرض ويندوز تحذير حماية. اختر',
    'More info': 'مزيد من المعلومات', ', then': '، ثم', 'Run anyway': 'تشغيل على أي حال', '.': '.',
    'Requirements.': 'المتطلبات.',
    'Windows 10 or 11 (x64), or an Apple Silicon Mac with macOS 13 or later. Install the agent CLIs you want to use: Claude Code, Codex CLI, Gemini CLI. Node.js 20+ is only needed to install Codex and Gemini from inside Dawsha.': 'ويندوز 10 أو 11 بمعمارية x64، أو Mac بمعالج Apple Silicon وmacOS 13 أو أحدث. ثبّت أدوات الوكلاء التي تريدها: Claude Code وCodex CLI وGemini CLI. تحتاج Node.js 20+ فقط لتثبيت Codex وGemini من داخل دوشة.',
    'Stop hunting for the right window.': 'لا تبحث عن النافذة المناسبة بعد الآن.', 'Put every agent where you can read it.': 'ضع كل وكيل أمام عينيك.',
    'View on GitHub': 'اعرضه على GitHub', 'Changelog': 'سجل التغييرات', 'MIT licence': 'رخصة MIT'
  };

  const attributeTranslations = {
    'Dawsha showing four sessions in a 2 by 2 grid: Claude Code, Codex CLI and Gemini CLI on four sample projects': 'دوشة تعرض أربع جلسات في شبكة ٢×٢ لوكلاء Claude Code وCodex وGemini في مشاريع تجريبية',
    'The resume picker listing earlier sessions of all three agents with a preview of the selected one': 'قائمة استئناف جلسات الوكلاء الثلاثة مع معاينة الجلسة المحددة',
    'The command palette filtered by a short query, listing sessions, actions and projects': 'لوحة الأوامر تعرض الجلسات والإجراءات والمشاريع',
    'Two agents answering the same prompt side by side, each in its own worktree, with Keep A, Keep B and Diff buttons': 'وكيلان يجيبان على السؤال نفسه جنبًا إلى جنب في مساحتي عمل منفصلتين',
    'The Usage view with tokens per day by agent, limit history and tables by project and by agent': 'صفحة الاستخدام تعرض الرموز اليومية وسجل الحدود حسب المشروع والوكيل',
    'Dawsha Skills tab showing installed Claude, Codex, Gemini and shared skills with their locations': 'تبويب المهارات في دوشة يعرض مهارات Claude وCodex وGemini والمهارات المشتركة ومواقعها',
    'Dawsha Skills tab showing installed agent definitions with their locations': 'تبويب المهارات في دوشة يعرض تعريفات الوكلاء المثبتة ومواقعها',
    'A session with the sub-agents drawer open next to its terminal': 'مساحة في دوشة تعرض لوحة نشاط الوكلاء بجوار الطرفية',
    'Dawsha logo: a terminal inside a speech bubble': 'شعار دوشة: طرفية داخل فقاعة محادثة',
    'Primary': 'التنقل الرئيسي', 'Dawsha home': 'الصفحة الرئيسية لدوشة',
    'Three agents moving into one window': 'ثلاثة وكلاء يدخلون نافذة واحدة',
    'A quiet desk with a monitor showing the Dawsha grid, a plant and a cup of tea': 'مكتب هادئ مع شاشة تعرض شبكة دوشة ونبتة وكوب شاي',
    'dawsha command examples': 'أمثلة لأوامر دوشة'
  };

  const button = document.querySelector('.lang-switch');
  const nodes = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement.closest('script,style,svg,pre,code,.lang-switch')) continue;
    const key = node.textContent.trim();
    if (key && Object.prototype.hasOwnProperty.call(translations, key)) nodes.push({ node, english: node.textContent, arabic: node.textContent.replace(key, translations[key]) });
  }
  const attributes = [];
  document.querySelectorAll('[alt],[aria-label]').forEach((element) => {
    for (const name of ['alt', 'aria-label']) {
      const english = element.getAttribute(name);
      if (english && attributeTranslations[english]) attributes.push({ element, name, english, arabic: attributeTranslations[english] });
    }
  });
  const englishTitle = document.title;
  const description = document.querySelector('meta[name="description"]');
  const englishDescription = description?.content;
  const arabicTitle = 'دوشة — كل وكلاء البرمجة في نافذة واحدة';
  const arabicDescription = 'دوشة يجمع Claude Code وCodex وGemini في نافذة واحدة على ويندوز وأجهزة Mac بمعالج Apple Silicon ولينكس. مجاني، محلي، وبدون حساب.';
  const metadata = [
    ['meta[property="og:title"]', arabicTitle],
    ['meta[name="twitter:title"]', arabicTitle],
    ['meta[property="og:description"]', arabicDescription],
    ['meta[name="twitter:description"]', arabicDescription],
    ['meta[property="og:image:alt"]', 'دوشة تعرض أربع جلسات في شبكة من أربعة مساحات']
  ].map(([selector, arabic]) => {
    const element = document.querySelector(selector);
    return element ? { element, english: element.content, arabic } : null;
  }).filter(Boolean);
  function setLanguage(language) {
    const arabic = language === 'ar';
    document.documentElement.lang = language;
    document.documentElement.dir = arabic ? 'rtl' : 'ltr';
    document.title = arabic ? arabicTitle : englishTitle;
    if (description) description.content = arabic ? arabicDescription : englishDescription;
    for (const item of metadata) item.element.content = arabic ? item.arabic : item.english;
    for (const item of nodes) item.node.textContent = arabic ? item.arabic : item.english;
    for (const item of attributes) item.element.setAttribute(item.name, arabic ? item.arabic : item.english);
    document.querySelectorAll('[data-version]').forEach((element) => {
      const match = element.textContent.match(/(?:Version|الإصدار)\s+([0-9][0-9.]*)/);
      if (match) element.textContent = (arabic ? 'الإصدار ' : 'Version ') + match[1];
    });
    button.textContent = arabic ? 'English' : 'العربية';
    button.lang = arabic ? 'en' : 'ar';
    button.setAttribute('aria-label', arabic ? 'English' : 'العربية');
    const address = new URL(window.location.href);
    address.searchParams.set('lang', language);
    try { history.replaceState(null, '', address.href); } catch { /* Local file previews may disallow URL changes. */ }
    try { localStorage.setItem('dawsha-site-language', language); } catch { /* Preference is optional. */ }
  }
  let initial = 'en';
  try { if (localStorage.getItem('dawsha-site-language') === 'ar') initial = 'ar'; } catch { /* Private mode. */ }
  const requested = new URL(window.location.href).searchParams.get('lang');
  if (requested === 'en' || requested === 'ar') initial = requested;
  button.addEventListener('click', () => setLanguage(document.documentElement.lang === 'ar' ? 'en' : 'ar'));
  setLanguage(initial);
})();
