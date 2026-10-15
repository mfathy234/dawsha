(() => {
  const translations = {
    'Windows portable': 'نسخة ويندوز المحمولة', 'Windows 10/11 · Installer': 'ويندوز 10/11 · المثبّت',
    'No installation · x64': 'دون تثبيت · x64', 'Apple Silicon · DMG': 'Apple Silicon · DMG',
    'x64 · AppImage': 'x64 · AppImage', 'x64 · .deb': 'x64 · .deb',
    'Linux Debian / Ubuntu': 'لينكس ديبيان / أوبونتو', 'Download installer': 'تنزيل المثبّت',
    '.exe · Recommended': '.exe · موصى به', 'Download portable': 'تنزيل النسخة المحمولة',
    '.exe': '.exe', 'Download for macOS': 'تنزيل لنظام macOS',
    'Download AppImage': 'تنزيل AppImage', 'Download Debian / Ubuntu': 'تنزيل ديبيان / أوبونتو',
    'More download options': 'خيارات تنزيل أخرى', 'View all releases': 'عرض كل الإصدارات',
    'View on GitHub': 'اعرضه على GitHub',
    'Windows 10/11 · 64-bit installer': 'ويندوز 10/11 · مثبّت 64 بت', 'Other platforms': 'أنظمة أخرى', 'Linux AppImage': 'لينكس AppImage', 'Debian / Ubuntu': 'ديبيان / أوبونتو', 'Windows installer': 'مثبّت ويندوز', 'macOS': 'macOS',
    'Choose a download': 'اختر طريقة التنزيل', 'Installer': 'المثبّت', 'Recommended': 'موصى به',
    'Portable': 'محمول', 'No installation': 'دون تثبيت', 'Disk image': 'ملف تثبيت',
    'AppImage': 'AppImage',
    'Windows 10 or 11 · x64': 'ويندوز 10 أو 11 · x64',
    'Apple Silicon · macOS 13 or later': 'Apple Silicon · macOS 13 أو أحدث',
    'x64 · AppImage or Debian / Ubuntu': 'x64 · AppImage أو ديبيان / أوبونتو',
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
    'Remote Control ': '\u0627\u0644\u062a\u062d\u0643\u0645 \u0639\u0646 \u0628\u064f\u0639\u062f ',
    'Beta': '\u0628\u064a\u062a\u0627',
    'Remote Control (Beta)': '\u0627\u0644\u062a\u062d\u0643\u0645 \u0639\u0646 \u0628\u064f\u0639\u062f (\u0628\u064a\u062a\u0627)',
    'Pair a browser with your running Dawsha app. Input and session controls stay off until you enable them.': '\u0627\u0642\u0631\u0646 \u0645\u062a\u0635\u0641\u062d\u064b\u0627 \u0628\u062a\u0637\u0628\u064a\u0642 \u062f\u0648\u0634\u0629 \u0627\u0644\u0645\u0634\u063a\u0651\u0644. \u064a\u0638\u0644 \u0625\u062f\u062e\u0627\u0644 \u0627\u0644\u0623\u0648\u0627\u0645\u0631 \u0648\u0627\u0644\u062a\u062d\u0643\u0645 \u0628\u0627\u0644\u062c\u0644\u0633\u0627\u062a \u0645\u0639\u0637\u0651\u0644\u064e\u064a\u0646 \u062d\u062a\u0649 \u062a\u0641\u0639\u064a\u0644\u0647\u0645\u0627.',
    'Resizable Projects panel': '\u0644\u0648\u062d\u0629 \u0645\u0634\u0627\u0631\u064a\u0639 \u0642\u0627\u0628\u0644\u0629 \u0644\u062a\u063a\u064a\u064a\u0631 \u0627\u0644\u062d\u062c\u0645',
    'Drag the sidebar edge to set a width that suits your projects; Dawsha remembers it.': '\u0627\u0633\u062d\u0628 \u062d\u0627\u0641\u0629 \u0627\u0644\u0634\u0631\u064a\u0637 \u0627\u0644\u062c\u0627\u0646\u0628\u064a \u0644\u062a\u062e\u062a\u0627\u0631 \u0627\u0644\u0639\u0631\u0636 \u0627\u0644\u0645\u0646\u0627\u0633\u0628 \u0644\u0645\u0634\u0627\u0631\u064a\u0639\u0643\u060c \u0648\u0633\u064a\u062a\u0630\u0643\u0631\u0647 \u062f\u0648\u0634\u0629.',
    'Find and resume sessions': 'ابحث عن الجلسات واستأنفها',
    'Ctrl+Shift+R searches prompts and replies. Choose the current project or include all projects.': 'ابحث في الأسئلة والردود باستخدام Ctrl+Shift+R. اختر المشروع الحالي أو جميع المشاريع.',
    'Keep closed sessions': 'احتفظ بالجلسات المغلقة',
    'Closed tabs stay under their project until you remove them there. Resume one whenever you need it.': 'تبقى الألسنة المغلقة تحت مشروعها حتى تزيلها منه. يمكنك استئنافها وقتما تشاء.',
    'Project tasks': 'مهام المشروع',
    'Keep a task timeline with notes, commit references and linked sessions.': 'احتفظ بسجل للمهمة يتضمن الملاحظات ومراجع الالتزامات والجلسات المرتبطة.',
    'Gemini tool activity': 'نشاط أدوات Gemini',
    "See Gemini's recent tools beside its session and in the agents drawer.": 'اطّلع على أحدث أدوات Gemini بجوار مساحته وفي لوحة الوكلاء.',
    'New in 1.0': 'الجديد في 1.0',
    'Board, timeline, replay and phone approvals': 'اللوحة والخط الزمني وإعادة التشغيل والموافقة من الهاتف',
    'See what every session needs, look back at what it did, and answer from your phone.': 'اعرف ما تحتاجه كل جلسة، وراجع ما فعلته، وأجبها من هاتفك.',
    'Sessions board': 'لوحة الجلسات',
    'Switch the grid to a board with four columns: Needs you, Working, Done to review and Reviewed. Cards move by themselves as sessions change.': 'حوّل الشبكة إلى لوحة بأربعة أعمدة: تحتاج تدخلك، قيد العمل، انتهت وتنتظر المراجعة، وتمت مراجعتها. تنتقل البطاقات وحدها كلما تغيّرت حالة الجلسات.',
    'Allow or Deny a permission prompt right on the card.': 'اسمح بطلب الإذن أو ارفضه من البطاقة نفسها.',
    'Click a card to peek at the live terminal and send a reply.': 'اضغط على البطاقة لتطّلع على الطرفية الحية وترسل ردًّا.',
    'Drag a finished session to Reviewed, or close all reviewed sessions at once.': 'اسحب الجلسة المنتهية إلى عمود تمت مراجعتها، أو أغلق كل الجلسات التي روجعت دفعة واحدة.',
    'Filter by project and agent. Ctrl+Shift+B switches between the board and the grid.': 'صفِّ حسب المشروع والوكيل. يبدّل Ctrl+Shift+B بين اللوحة والشبكة.',
    'Session timeline': 'الخط الزمني للجلسة',
    'Every prompt, edit, command and test run of a session in one list, with insights on the files touched most and how the test runs went.': 'كل سؤال وتعديل وأمر وتشغيل اختبار في الجلسة ضمن قائمة واحدة، مع معلومات عن أكثر الملفات تعديلًا ونتائج الاختبارات.',
    'Filter by Prompts, Edits, Commands, Tests or Approvals, and search inside the session.': 'صفِّ حسب الأسئلة أو التعديلات أو الأوامر أو الاختبارات أو الموافقات، وابحث داخل الجلسة.',
    'Click an edit to see exactly what changed.': 'اضغط على أي تعديل لترى ما تغيّر بالضبط.',
    'Export the timeline as Markdown. Ctrl+Shift+T opens it.': 'صدّر الخط الزمني بصيغة Markdown. يفتحه Ctrl+Shift+T.',
    'Search every session, even closed ones': 'ابحث في كل الجلسات، حتى المغلقة',
    'Ctrl+Alt+F searches the prompts, replies, edits and commands of all your sessions, including ones you closed days ago.': 'يبحث Ctrl+Alt+F في أسئلة وردود وتعديلات وأوامر كل جلساتك، ومنها جلسات أغلقتها قبل أيام.',
    'Matches are grouped by session, with the agent, project and date.': 'تُجمَّع النتائج حسب الجلسة، مع الوكيل والمشروع والتاريخ.',
    'Open a match read only at the exact point, or resume the session from there.': 'افتح النتيجة للقراءة فقط عند موضعها بالضبط، أو استأنف الجلسة من هناك.',
    'Narrow the search by project, agent or kind of event.': 'ضيّق البحث حسب المشروع أو الوكيل أو نوع الحدث.',
    'Replay': 'إعادة التشغيل',
    'Watch a recorded terminal play back like a video. Recording is off until you turn it on in Settings, and recordings never leave your computer.': 'شاهد طرفية مسجّلة تُعاد كأنها فيديو. التسجيل متوقف حتى تفعّله من الإعدادات، ولا تغادر التسجيلات جهازك.',
    'Jump between markers for prompts, permission requests and the end of the session.': 'انتقل بين العلامات الخاصة بالأسئلة وطلبات الإذن ونهاية الجلسة.',
    'Search the recording and jump to a match.': 'ابحث في التسجيل وانتقل إلى النتيجة.',
    'Skip idle time, play at 4x or 16x, or copy the text on screen.': 'تجاوز فترات الخمول، أو شغّل بسرعة 4x أو 16x، أو انسخ النص الظاهر على الشاشة.',
    'Choose how long to keep recordings and how much disk they may use, and pause recording per pane. Open Replay from the pane header or the timeline.': 'حدّد مدة الاحتفاظ بالتسجيلات والمساحة التي قد تستهلكها، وأوقف التسجيل لكل جلسة على حدة. افتح إعادة التشغيل من رأس الجلسة أو من الخط الزمني.',
    'Approve from your phone': 'وافق من هاتفك',
    'The Approvals tab lists every session waiting on you. Allow once, or Deny with a reason the agent reads. Notifications arrive while the page is open.': 'يعرض تبويب الموافقات كل جلسة تنتظرك. اسمح مرة واحدة، أو ارفض مع سبب يقرؤه الوكيل. تصلك التنبيهات ما دامت الصفحة مفتوحة.',
    'Safe by default': 'آمن افتراضيًا',
    'Only a plain Yes can be allowed from the phone. Edits to CI, config, .git and .claude files can only be denied; open Dawsha to allow them.': 'لا يمكن السماح من الهاتف إلا بخيار نعم العادي. أما تعديل ملفات CI والإعدادات و.git و.claude فيمكن رفضه فقط؛ افتح دوشة للسماح به.',
    'Back up and move': 'انسخ احتياطيًا وانقل',
    'Export your settings to one JSON file without remote-access secrets, then import it on another computer with Merge or Replace.': 'صدّر إعداداتك إلى ملف JSON واحد دون أسرار الوصول عن بُعد، ثم استورده على جهاز آخر بخيار الدمج أو الاستبدال.',
    'Close confirmation': 'تأكيد الإغلاق',
    'Dawsha asks before closing a session only while it is working. Idle, done and exited sessions close straight away.': 'تسألك دوشة قبل إغلاق الجلسة فقط وهي تعمل. أما الجلسات الخاملة والمنتهية والمغلقة فتُغلق فورًا.',
    'Skip to content': 'انتقل إلى المحتوى',
    'Remote': 'عن بُعد',
    'Remote Control': 'التحكم عن بُعد',
    'Your agents, in your pocket.': 'وكلاؤك في جيبك.',
    'Step away from your desk and keep going. Turn on Remote Access in Settings, open the link on your phone and enter the pairing code. Your sessions keep running on your computer.': 'ابتعد عن مكتبك وواصل العمل. فعّل الوصول عن بُعد من الإعدادات، وافتح الرابط على هاتفك وأدخل رمز الاقتران. تبقى جلساتك تعمل على جهازك.',
    'The real terminal': 'الطرفية الحقيقية',
    "Claude Code and Codex redraw at your phone's size, so tables, code and prompts line up.": 'يعيد Claude Code وCodex الرسم بمقاس هاتفك، فتظهر الجداول والأكواد والأسئلة مرتبة.',
    'Reply from anywhere': 'ردّ من أي مكان',
    'Type a message and send it. Esc, the arrow keys, Tab, Enter and Ctrl+C are one tap away for menus and approvals.': 'اكتب رسالتك وأرسلها. مفاتيح Esc والأسهم وTab وEnter وCtrl+C على بُعد لمسة للقوائم والموافقات.',
    'Start or resume sessions': 'ابدأ الجلسات أو استأنفها',
    'Open a new session in any project, or pick up a recent one.': 'افتح جلسة جديدة في أي مشروع، أو أكمل جلسة حديثة.',
    'You set the limits': 'أنت تحدد الصلاحيات',
    'Paired browsers start read only. Allow typing and session control separately, and revoke a browser at any time.': 'تبدأ المتصفحات المقترنة للقراءة فقط. اسمح بالكتابة والتحكم بالجلسات كلٌّ على حدة، وألغِ أي متصفح متى شئت.',
    'Private link': 'رابط خاص',
    'Traffic goes through a temporary Cloudflare Quick Tunnel. Add an email PIN for a second gate.': 'تمر الحركة عبر نفق Cloudflare Quick Tunnel مؤقت. أضف رمز PIN عبر البريد كحماية ثانية.',
    'Screens': 'صور التطبيق', 'Features': 'المميزات', 'Command': 'سطر الأوامر', 'Download': 'التحميل',
    'For Claude Code, Codex CLI and Gemini CLI': 'لـ Claude Code وCodex CLI وGemini CLI',
    'Every AI coding agent, one readable window.': 'كل وكلاء البرمجة بالذكاء الاصطناعي في نافذة واحدة واضحة.',
    'Run Claude Code, Codex and Gemini side by side in large, readable terminals, one session per task.': 'شغّل Claude Code وCodex وGemini جنبًا إلى جنب في طرفيات واسعة وواضحة، مع مساحة مستقلة لكل مهمة.',
    'Download for Windows': 'حمّل لويندوز', 'Portable version': 'النسخة المحمولة',
    'Apple Silicon Mac': 'ماك بمعالج Apple Silicon',
    'macOS 13 or later · ARM64 DMG · Drag Dawsha to Applications.': 'macOS 13 أو أحدث · ملف DMG بمعمارية ARM64 · اسحب دوشة إلى التطبيقات.',
    'Download for Mac': 'تنزيل لنظام Mac',
    'Works with': 'يعمل مع',
    'See it in 20 seconds': 'شاهده في 20 ثانية',
    'Your own installs and sign-ins. Dawsha never handles credentials.': 'استخدم تثبيتاتك وحساباتك الحالية. دوشة لا تتعامل مع كلمات المرور.',
    'See it work': 'شاهد التطبيق', 'Real screenshots from the app, with sample projects.': 'صور حقيقية من التطبيق بمشاريع تجريبية.',
    'New session.': 'جلسة جديدة.',
    "Pick a project and an agent, see each agent's version and how much of your limits is left.": 'اختر المشروع والوكيل، وشاهد إصدار كل وكيل وكم تبقى من حدودك.',
    'Other sessions.': 'الجلسات الأخرى.',
    'Maximize one pane and the rest stay in view with live previews. Collapse the panel to a strip when you need the room.': 'كبّر لوحة واحدة وتبقى بقية الجلسات ظاهرة بمعاينة مباشرة. اطوِ اللوحة إلى شريط حين تحتاج المساحة.',
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
    'Themes': 'السمات', 'Seven themes, including card-style light and dark themes, with contrast checks and an optional background image.': 'سبع سمات، منها سمات فاتحة وداكنة بتصميم البطاقات، مع فحص للتباين وخيار إضافة صورة خلفية.',
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
    'Local by default': 'محلي بشكل افتراضي', 'No account or telemetry. Remote Control is optional and routes traffic through Cloudflare.': 'بلا حساب أو تتبع. التحكم عن بُعد اختياري ويمرّر الحركة عبر Cloudflare.',
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
    'The sessions board with four columns, Needs you, Working, Done to review and Reviewed, each holding a session card': 'لوحة الجلسات بأربعة أعمدة: تحتاج تدخلك، قيد العمل، انتهت وتنتظر المراجعة، وتمت مراجعتها، وفي كل عمود بطاقة جلسة',
    'A session with its timeline open, listing prompts, edits and test runs, with insights for the files touched most and the test results': 'جلسة مفتوح بجانبها الخط الزمني يعرض الأسئلة والتعديلات وتشغيلات الاختبار، مع معلومات عن أكثر الملفات تعديلًا ونتائج الاختبارات',
    'Searching all sessions for rate limit, with matches grouped under two closed Claude sessions from different projects': 'بحث في كل الجلسات عن rate limit، والنتائج مجمّعة تحت جلستي Claude مغلقتين من مشروعين مختلفين',
    'Replay of a recorded Claude Code session stopped at a permission prompt, with markers on the playback bar and a search box for the recording': 'إعادة تشغيل جلسة Claude Code مسجّلة متوقفة عند طلب إذن، مع علامات على شريط التشغيل ومربع بحث في التسجيل',
    'Dawsha Remote on a phone showing the Approvals tab with three agents waiting, each with Allow once and Deny buttons, and a file edit that can only be denied': 'دوشة عن بُعد على الهاتف تعرض تبويب الموافقات وثلاثة وكلاء ينتظرون، لكل منها زرا السماح مرة واحدة والرفض، مع تعديل ملف لا يمكن إلا رفضه',
    'Dawsha showing four sessions in a 2 by 2 grid: Claude Code, Codex CLI and Gemini CLI on four sample projects': 'دوشة تعرض أربع جلسات في شبكة ٢×٢ لوكلاء Claude Code وCodex وGemini في مشاريع تجريبية',
    'The New session dialog with project cards on the left and Claude, Codex and Gemini cards with versions and limit bars on the right': 'نافذة الجلسة الجديدة: المشاريع على اليسار وبطاقات Claude وCodex وGemini بالإصدارات وأشرطة الحدود على اليمين',
    'A maximized session with the Other sessions panel on the right showing live previews of three more sessions': 'جلسة مكبرة ولوحة الجلسات الأخرى على اليمين بمعاينة مباشرة لثلاث جلسات أخرى',
    'The resume picker listing earlier sessions of all three agents with a preview of the selected one': 'قائمة استئناف جلسات الوكلاء الثلاثة مع معاينة الجلسة المحددة',
    'The command palette filtered by a short query, listing sessions, actions and projects': 'لوحة الأوامر تعرض الجلسات والإجراءات والمشاريع',
    'Two agents answering the same prompt side by side, each in its own worktree, with Keep A, Keep B and Diff buttons': 'وكيلان يجيبان على السؤال نفسه جنبًا إلى جنب في مساحتي عمل منفصلتين',
    'The Usage view with tokens per day by agent, limit history and tables by project and by agent': 'صفحة الاستخدام تعرض الرموز اليومية وسجل الحدود حسب المشروع والوكيل',
    'Dawsha Skills tab showing installed Claude, Codex, Gemini and shared skills with their locations': 'تبويب المهارات في دوشة يعرض مهارات Claude وCodex وGemini والمهارات المشتركة ومواقعها',
    'Dawsha Skills tab showing installed agent definitions with their locations': 'تبويب المهارات في دوشة يعرض تعريفات الوكلاء المثبتة ومواقعها',
    'A session with the sub-agents drawer open next to its terminal': 'مساحة في دوشة تعرض لوحة نشاط الوكلاء بجوار الطرفية',
    'Dawsha logo: a terminal inside a speech bubble': 'شعار دوشة: طرفية داخل فقاعة محادثة',
    'Primary': 'التنقل الرئيسي', 'Dawsha home': 'الصفحة الرئيسية لدوشة',
    'A 20 second tour: four agent windows become one Dawsha grid, an amber border marks the session that needs you, Ctrl+K opens the palette, and Remote Control answers from a phone': 'جولة في 20 ثانية: أربع نوافذ للوكلاء تصبح شبكة واحدة في دوشة، وإطار كهرماني يميز الجلسة التي تحتاجك، وCtrl+K يفتح لوحة الأوامر، والتحكم عن بُعد يرد من الهاتف',
    'Pause the demo': 'إيقاف العرض مؤقتًا',
    'Three agents moving into one window': 'ثلاثة وكلاء يدخلون نافذة واحدة',
    'A quiet desk with a monitor showing the Dawsha grid, a plant and a cup of tea': 'مكتب هادئ مع شاشة تعرض شبكة دوشة ونبتة وكوب شاي',
    'dawsha command examples': 'أمثلة لأوامر دوشة',
    'Dawsha Remote on a phone listing running Claude and Codex sessions and recent sessions to resume': 'دوشة عن بُعد على الهاتف تعرض جلسات Claude وCodex الجارية وجلسات حديثة للاستئناف',
    'Dawsha Remote on a phone showing a Claude Code reply with numbered steps and a code block, above a message box': 'دوشة عن بُعد على الهاتف تعرض رد Claude Code بخطوات مرقمة ومقطع كود، فوق مربع الرسالة'
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
