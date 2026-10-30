(() => {
  const translations = {
    "New in 1.8.0": "الجديد في 1.8.0",
    "1.8.0 is a full redesign: one type, colour and spacing system, one style for every control, a top bar with the pages in it, two ways to lay out sessions, and an approval card that shows what an agent is asking. It also carries the 1.7.6 and 1.7.5 changes.": "يقدّم 1.8.0 إعادة تصميم كاملة: نظام واحد للخطوط والألوان والمسافات، ونمط واحد لكل عنصر تحكم، وشريط علوي يضم الصفحات، وطريقتان لترتيب الجلسات، وبطاقة موافقة تُظهر ما يطلبه الوكيل. ويحمل أيضًا تغييرات 1.7.6 و1.7.5.",
    "A new look, one style": "مظهر جديد ونمط واحد",
    "Buttons, tabs, menus, dialogs, toggles and dropdowns share one style, set in Geist and JetBrains Mono, which are bundled with the app so text looks the same on every computer.": "تشترك الأزرار والتبويبات والقوائم والنوافذ والمفاتيح والقوائم المنسدلة في نمط واحد، بخطي Geist وJetBrains Mono المرفقين مع التطبيق، ليبدو النص واحدًا على كل حاسوب.",
    "The top bar holds Sessions, Agents, Files, Work and Skills, with the page you are on highlighted, next to one usage strip.": "يضم الشريط العلوي الجلسات والوكلاء والملفات والعمل والمهارات، مع إبراز الصفحة التي تفتحها، بجانب شريط استخدام واحد.",
    "New session sits at the right end with its agent menu and its Ctrl+N hint.": "يقع زر جلسة جديدة في أقصى اليمين، مع قائمة الوكلاء وتلميح Ctrl+N.",
    "The light theme is readable: terminal text is at least 4.5:1 against its background.": "السمة الفاتحة واضحة: نص الطرفية بتباين 4.5:1 على الأقل مع خلفيته.",
    "Two ways to see your sessions": "طريقتان لعرض جلساتك",
    "Calm focus, the default, gives one large session the room while the others wait beside it. Mission control gives every session an equal tile.": "التركيز الهادئ، وهو الافتراضي، يمنح جلسة واحدة كبيرة المساحة بينما تنتظر الأخرى بجانبها. والتحكم المركزي يمنح كل جلسة بطاقة متساوية.",
    "Switch in Settings, under Appearance, or from the Layouts button beside Grid and Board.": "بدّل من الإعدادات، ضمن المظهر، أو من زر التخطيطات بجانب الشبكة واللوح.",
    "Both styles keep the same approval cards, status and edges, so nothing that needs you is hidden.": "يحتفظ النمطان ببطاقات الموافقة والحالة والحواف نفسها، فلا يختفي شيء يحتاج إلى قرارك.",
    "An approval card that says what it wants": "بطاقة موافقة تُظهر ما يطلبه الوكيل",
    "A session that needs you gets an orange edge and a card with the tool, the command and the project, so you can decide without reading the whole terminal.": "تحصل الجلسة التي تحتاج إليك على حافة برتقالية وبطاقة تعرض الأداة والأمر والمشروع، لتقرر دون قراءة الطرفية كاملة.",
    "Allow, Allow always (when the agent offers it) and Deny are on the card, with Enter and Esc shown on the buttons.": "تظهر على البطاقة خيارات السماح والسماح دائمًا (عندما يعرضها الوكيل) والرفض، مع عرض Enter وEsc على الأزرار.",
    "Each pane's menu is grouped into 13 items. The other actions are in the command palette.": "تنقسم قائمة كل لوحة إلى 13 بندًا. وبقية الإجراءات في لوحة الأوامر.",
    "Panes show a footer only when it has something to show.": "لا تظهر تذييلات اللوحات إلا حين يكون لديها ما تعرضه.",
    "Agents, each on its own page": "وكلاء، لكل منهم صفحته",
    "Maya's goal box sits on top, and every agent is a card with its purpose, model, last run and a Run button.": "يقع مربع هدف Maya في الأعلى، وكل وكيل بطاقة تعرض غرضه ونموذجه وآخر تشغيل وزر تشغيل.",
    "Open an agent to see it on its own page, with a Live tab while it runs.": "افتح الوكيل لتراه في صفحته الخاصة، مع تبويب مباشر أثناء تشغيله.",
    "Maya the Lead is shown on her own, so the counter at the top matches the sections.": "تظهر Maya القائدة وحدها، فيتطابق العداد في الأعلى مع الأقسام.",
    "Settings in sections": "الإعدادات في أقسام",
    "Settings is split into sections with a search box, and Import opens a file picker at your Desktop.": "قُسّمت الإعدادات إلى أقسام مع مربع بحث، ويفتح الاستيراد منتقي ملفات على سطح المكتب.",
    "Linked skills are marked Linked in Skills, and every skill shows its description.": "تُعلَّم المهارات المرتبطة في المهارات بكلمة مرتبط، ويعرض كل مهارة وصفها.",
    "Projects can Locate a folder that has moved, and the sidebar resizes reliably.": "يمكن للمشاريع تحديد موقع مجلد تم نقله، ويعمل تغيير حجم الشريط الجانبي بثبات.",
    "Files shows one diff look, with Discard kept apart from Commit. What's new lists each release by section.": "تعرض الملفات نمط فروقات واحدًا، مع فصل التراجع عن الإيداع. وتعرض \"الجديد\" كل إصدار حسب أقسامه.",
    "From 1.7.6 and 1.7.5": "من 1.7.6 و1.7.5",
    "Calm focus: one large focused Claude Code session with an approval card asking to run a migration, and three smaller sessions beside it": "التركيز الهادئ: جلسة Claude Code كبيرة واحدة مع بطاقة موافقة تطلب تشغيل ترحيل، وثلاث جلسات أصغر بجانبها",
    "Mission control: four equal session tiles with an approval card on one of them that needs you": "التحكم المركزي: أربع بطاقات جلسات متساوية، وعلى إحداها بطاقة موافقة تحتاج إليك",
    "The Agents page with Maya's goal box on top, then the built-in agent cards, each with its purpose, model, last run and a Run button": "صفحة الوكلاء ومربع هدف Maya في الأعلى، ثم بطاقات الوكلاء المدمجة، ولكل منها غرضه ونموذجه وآخر تشغيل وزر تشغيل",
    "Settings open on Appearance, with the theme and the sessions grid style, Calm focus or Mission control, and a search box for settings": "الإعدادات مفتوحة على المظهر، مع السمة ونمط عرض الجلسات، التركيز الهادئ أو التحكم المركزي، ومربع بحث في الإعدادات",
    "Skip to content": "انتقل إلى المحتوى",
    "Screens": "صور التطبيق",
    "Remote": "عن بُعد",
    "Features": "المميزات",
    "Command": "سطر الأوامر",
    "Download": "التحميل",
    "Every AI coding agent, one readable window.": "كل وكلاء البرمجة بالذكاء الاصطناعي في نافذة واحدة واضحة.",
    "Run Claude Code, Codex and Gemini side by side in large, readable terminals, one session per task.": "شغّل Claude Code وCodex وGemini جنبًا إلى جنب في طرفيات واسعة وواضحة، مع مساحة مستقلة لكل مهمة.",
    "Download for Windows": "حمّل لويندوز",
    "Windows 10/11 · 64-bit installer": "ويندوز 10/11 · مثبّت 64 بت",
    "Other platforms": "أنظمة أخرى",
    "See it in 20 seconds": "شاهده في 20 ثانية",
    "Works with": "يعمل مع",
    "Your own installs and sign-ins. Dawsha never handles credentials.": "استخدم تثبيتاتك وحساباتك الحالية. دوشة لا تتعامل مع كلمات المرور.",
    "Agents you keep": "وكلاء تحتفظ بهم",
    "The Agents tab is now your crew. Each agent has a name, a role, its own instructions, prompt fields, a model, permissions and the projects it may work in.": "تبويب الوكلاء هو الآن طاقمك. لكل وكيل اسم ودور وتعليمات خاصة به وحقول للطلب ونموذج وصلاحيات والمشاريع التي يعمل فيها.",
    "Eight built-in agents ship with Dawsha: Maya the Lead, Sami, Tarek, Omar, Hana, Lina, Nour and Yara. Duplicate one to change it, or make your own.": "يأتي مع دوشة ثمانية وكلاء مدمجين: Maya القائدة وSami وTarek وOmar وHana وLina وNour وYara. كرّر أيًّا منهم لتعدّله، أو أنشئ وكيلك الخاص.",
    "Run an agent in any project and pick the model for that run: Claude Fable, Opus, Sonnet or Haiku, Codex or Gemini. Each run opens as a normal session titled with the agent's name, like \"Sami · PR 8841\".": "شغّل وكيلًا في أي مشروع واختر النموذج لتلك المرة: Claude Fable أو Opus أو Sonnet أو Haiku، أو Codex أو Gemini. تُفتح كل مرة جلسة عادية بعنوان يحمل اسم الوكيل، مثل «Sami · PR 8841».",
    "Runs start lean, without your MCP servers. That was about 40% cheaper in our tests than running the same instructions as a skill.": "تبدأ التشغيلات خفيفة، بلا خوادم MCP الخاصة بك. وكان ذلك أرخص بنحو 40% في اختباراتنا من تشغيل التعليمات نفسها كمهارة.",
    "In Skills, Make an agent turns a skill into an agent and says why for every choice. You can also import your Claude agents and Codex prompts.": "في المهارات، يحوّل «إنشاء وكيل» المهارة إلى وكيل ويذكر السبب لكل خيار. ويمكنك أيضًا استيراد وكلاء Claude وطلبات Codex.",
    "Paste a correlation id with \"on dev\", a pull request link or a build link into New session, and Dawsha suggests the agent with its fields filled in.": "الصق معرّف تتبّع مع «on dev»، أو رابط طلب سحب، أو رابط بناء في «جلسة جديدة»، فتقترح دوشة الوكيل وقد ملأت حقوله.",
    "See who is working": "اعرف من يعمل",
    "An agent's avatar breathes while it works, flashes when it needs you, flashes once when it's done and shows ✕ when it fails, always with a word too.": "تتنفّس صورة الوكيل أثناء عمله، وتومض حين يحتاجك، وتومض مرة واحدة حين ينتهي، وتُظهر ✕ حين يفشل، وبجانبها دائمًا كلمة.",
    "The top bar shows who is on a job. Sessions, the sidebar, Waiting on you and notifications show the agent's name and avatar.": "يبيّن الشريط العلوي من يعمل على مهمة. وتعرض الجلسات والشريط الجانبي و«بانتظارك» والإشعارات اسم الوكيل وصورته.",
    "Every run is a normal session, so it sits in the grid, the board and Resume like any other.": "كل تشغيل جلسة عادية، فيظهر في الشبكة واللوحة والاستئناف كأي جلسة أخرى.",
    "The dawsha crew command lists your agents and runs them from a terminal, with status and result.": "يسرد الأمر dawsha crew وكلاءك ويشغّلهم من الطرفية، مع الحالة والنتيجة.",
    "Maya, the Lead": "Maya، القائدة",
    "Give Maya a goal and a project. She plans, you approve, and she runs the agents as normal sessions.": "أعطِ Maya هدفًا ومشروعًا. هي تخطط، وأنت توافق، وهي تشغّل الوكلاء كجلسات عادية.",
    "She proposes a plan first: who does what, on which model, at what estimated cost. Nothing starts until you approve it.": "تقترح خطة أولًا: من يفعل ماذا، وبأي نموذج، وبأي تكلفة مقدّرة. ولا يبدأ شيء حتى توافق عليها.",
    "Approved jobs show as lanes on a board, each with the agent's live state.": "تظهر المهام الموافَق عليها كمسارات على لوحة، ولكل مسار حالة الوكيل الحيّة.",
    "She asks you before pushing, merging, posting comments or deleting. The question waits on the board for your answer.": "تسألك قبل الدفع أو الدمج أو نشر التعليقات أو الحذف. ويبقى السؤال على اللوحة بانتظار إجابتك.",
    "Dawsha enforces her limits, not Maya: how many agents run at once (2 by default), a budget per goal ($3 by default) and which agents she may use. Change them under How she leads.": "دوشة هي من تفرض حدودها، لا Maya: كم وكيلًا يعمل في وقت واحد (اثنان افتراضيًا)، وميزانية لكل هدف (3 دولارات افتراضيًا)، وأي الوكلاء يجوز لها استخدامهم. غيّرها تحت «كيف تقود».",
    "Agents and Remote Access on your phone": "الوكلاء والوصول عن بُعد على هاتفك",
    "Remote Access has an Agents tab. Run one of your agents on your PC from the phone, and follow what is on a job and the goal Maya is working on.": "في الوصول عن بُعد تبويب للوكلاء. شغّل أحد وكلائك على حاسوبك من الهاتف، وتابع من يعمل على مهمة والهدف الذي تعمل عليه Maya.",
    "Running agents from the phone is behind a new Run agents permission, which is off by default.": "تشغيل الوكلاء من الهاتف خلف صلاحية جديدة اسمها «تشغيل الوكلاء»، وهي معطّلة افتراضيًا.",
    "Remote Access says plainly whether your phone can reach this PC. It notices a dropped tunnel in about ten seconds, offers Reconnect, and can reconnect on its own.": "يقول الوصول عن بُعد بوضوح إن كان هاتفك يصل إلى هذا الجهاز. ويلاحظ انقطاع النفق خلال نحو عشر ثوانٍ، ويعرض «إعادة الاتصال»، ويمكنه إعادة الاتصال وحده.",
    "The Remote Access page is rebuilt: connect a phone, your phones (Remove asks first and names the phone), what a phone can do, now enforced on the PC, and a recent activity log.": "أُعيد بناء صفحة الوصول عن بُعد: ربط هاتف، وهواتفك (يسأل «إزالة» أولًا ويذكر اسم الهاتف)، وما يستطيع الهاتف فعله وقد صار مفروضًا على الحاسوب، وسجل نشاط حديث.",
    "The phone app has real agent logos, filled cards, big buttons and a light theme.": "في تطبيق الهاتف شعارات حقيقية للوكلاء، وبطاقات ممتلئة، وأزرار كبيرة، ومظهر فاتح.",
    "From 1.7.5": "من 1.7.5",
    "Shipped just before 1.7.6, and worth a second look.": "صدر قبل 1.7.6 بقليل، ويستحق نظرة ثانية.",
    "A much smaller app.": "تطبيق أصغر بكثير.",
    "The Windows installer went from 199 MB to 114 MB.": "نزل مثبّت ويندوز من 199 ميغابايت إلى 114 ميغابايت.",
    "A clearer sidebar.": "شريط جانبي أوضح.",
    "Active projects sit on cards, pinned projects come first, and projects with no sessions fold into one quiet list.": "تجلس المشاريع النشطة على بطاقات، وتأتي المشاريع المثبّتة أولًا، وتُطوى المشاريع التي بلا جلسات في قائمة هادئة واحدة.",
    "Codex limits.": "حدود Codex.",
    "The limits popover shows Codex next to Claude, and the account you are signed in with.": "تعرض نافذة الحدود Codex بجانب Claude، والحساب الذي سجّلت الدخول به.",
    "A Problems tab.": "تبويب المشكلات.",
    "Files lists the errors and warnings from a run, by file, and opens each at its line.": "يسرد عرض الملفات الأخطاء والتحذيرات الناتجة عن تشغيل، بحسب الملف، ويفتح كلًا منها عند سطره.",
    "Earlier releases": "الإصدارات السابقة",
    "Search and Review in Files, with comments you send to the agent. A details pane for background agents, since replaced by your own agents. A Projects sidebar built around what needs you, and refined Dawsha Cards.": "البحث والمراجعة في الملفات، مع تعليقات ترسلها إلى الوكيل. ولوحة تفاصيل لوكلاء الخلفية، حلّ محلها وكلاؤك أنت. وشريط مشاريع مبني حول ما يحتاجك، وبطاقات Dawsha Cards مصقولة.",
    "Notes for 1.7.4": "ملاحظات الإصدار 1.7.4",
    "The Files view with Ctrl+P quick open, session tags that colour themselves, and a calmer grid. Later 1.7 releases added worktree browsing in Files, a Delete that asks first and uses the Recycle Bin, and run commands for .NET and Node projects.": "عرض الملفات مع الفتح السريع بـ ⁨Ctrl+P⁩، ووسوم جلسات تتلوّن من تلقاء نفسها، وشبكة أهدأ. وأضافت إصدارات 1.7 اللاحقة تصفح أشجار العمل في الملفات، وحذفًا يسأل أولًا ويستخدم سلة المحذوفات، وأوامر تشغيل لمشاريع .NET وNode.",
    "Notes for 1.7": "ملاحظات الإصدار 1.7",
    "Arabic in every session, voice dictation, a calmer grid, the Agents tab and a handoff that carries the whole conversation. Installing Claude Code from Dawsha no longer breaks an existing install.": "العربية في كل جلسة، والإملاء الصوتي، وشبكة أهدأ، وتبويب الوكلاء، ونقل يحمل المحادثة كاملة. ولم يعد تثبيت Claude Code من دوشة يُفسد تثبيتًا موجودًا.",
    "Notes for 1.6": "ملاحظات الإصدار 1.6",
    "The Orchestrator hands a feature or a bug to a team of agents. The Work dashboard and Tickets show where your day went, and Remote Control connects more reliably.": "يسلّم المنسّق ميزة أو خطأً إلى فريق من الوكلاء. وتُظهر لوحة العمل والتذاكر أين ذهب يومك، ويتصل التحكم عن بُعد بثبات أكبر.",
    "Notes for 1.5": "ملاحظات الإصدار 1.5",
    "The sessions board, the session timeline, search across every session, Replay, and approvals from your phone.": "لوحة الجلسات، والخط الزمني للجلسة، والبحث في كل الجلسات، وإعادة التشغيل، والموافقة من هاتفك.",
    "Notes for 1.0": "ملاحظات الإصدار 1.0",
    "Full changelog": "سجل التغييرات الكامل",
    "See it work": "شاهد التطبيق",
    "Real screenshots from the app, with sample projects.": "صور حقيقية من التطبيق بمشاريع تجريبية.",
    "New session.": "جلسة جديدة.",
    "Pick a project and an agent, see each agent's version and how much of your limits is left.": "اختر المشروع والوكيل، وشاهد إصدار كل وكيل وكم تبقى من حدودك.",
    "Other sessions.": "الجلسات الأخرى.",
    "Maximize one pane and the rest stay in view with live previews. Collapse the panel to a strip when you need the room.": "كبّر لوحة واحدة وتبقى بقية الجلسات ظاهرة بمعاينة مباشرة. اطوِ اللوحة إلى شريط حين تحتاج المساحة.",
    "Resume anything.": "أكمل من حيث توقفت.",
    "One list of earlier sessions across all three agents, with search and a preview.": "كل جلسات الوكلاء الثلاثة في قائمة واحدة، مع البحث والمعاينة.",
    "Command palette.": "لوحة الأوامر.",
    "Ctrl+K reaches sessions, projects and layouts from the keyboard.": "اختصار Ctrl+K يوصلك إلى الجلسات والمشاريع والتخطيطات من لوحة المفاتيح.",
    "Ask two agents.": "اسأل وكيلين.",
    "Same prompt, two answers, each in its own git worktree. Keep one, both, or diff.": "نفس السؤال وإجابتان في مساحتي عمل منفصلتين. احتفظ بإحداهما أو كلتيهما أو قارن الفروق.",
    "Usage.": "الاستخدام.",
    "Tokens per day, cost where an agent reports one, and your 5 hour and weekly limits.": "الرموز يوميًا، والتكلفة حين يتيحها الوكيل، وحدود الخمس ساعات والأسبوع.",
    "Skills.": "المهارات.",
    "Find, open, copy and export skills installed for each agent.": "ابحث عن المهارات المثبتة لكل وكيل وافتحها وانسخ مساراتها أو صدّرها.",
    "Installed agents.": "الوكلاء المثبتون.",
    "Browse and export your agent definitions, including project agents.": "تصفح تعريفات وكلائك وصدّرها، بما فيها وكلاء المشاريع.",
    "Your agents, in your pocket.": "وكلاؤك في جيبك.",
    "Step away from your desk and keep going. Turn on Remote Access in Settings, open the link on your phone and enter the pairing code. Your sessions keep running on your computer.": "ابتعد عن مكتبك وواصل العمل. فعّل الوصول عن بُعد من الإعدادات، وافتح الرابط على هاتفك وأدخل رمز الاقتران. تبقى جلساتك تعمل على جهازك.",
    "The real terminal": "الطرفية الحقيقية",
    "Claude Code and Codex redraw at your phone's size, so tables, code and prompts line up.": "يعيد Claude Code وCodex الرسم بمقاس هاتفك، فتظهر الجداول والأكواد والأسئلة مرتبة.",
    "Approve from your phone": "وافق من هاتفك",
    "The Approvals tab lists every session waiting on you. Allow once, or Deny with a reason the agent reads. Notifications arrive while the page is open.": "يعرض تبويب الموافقات كل جلسة تنتظرك. اسمح مرة واحدة، أو ارفض مع سبب يقرؤه الوكيل. تصلك التنبيهات ما دامت الصفحة مفتوحة.",
    "Safe by default": "آمن افتراضيًا",
    "Only a plain Yes can be allowed from the phone. Edits to CI, config, .git and .claude files can only be denied; open Dawsha to allow them.": "لا يمكن السماح من الهاتف إلا بخيار نعم العادي. أما تعديل ملفات CI والإعدادات و.git و.claude فيمكن رفضه فقط؛ افتح دوشة للسماح به.",
    "Reply from anywhere": "ردّ من أي مكان",
    "Type a message and send it. Esc, the arrow keys, Tab, Enter and Ctrl+C are one tap away for menus and approvals.": "اكتب رسالتك وأرسلها. مفاتيح Esc والأسهم وTab وEnter وCtrl+C على بُعد لمسة للقوائم والموافقات.",
    "Start or resume sessions": "ابدأ الجلسات أو استأنفها",
    "Open a new session in any project, or pick up a recent one.": "افتح جلسة جديدة في أي مشروع، أو أكمل جلسة حديثة.",
    "You set the limits": "أنت تحدد الصلاحيات",
    "Paired browsers start read only. Allow typing and session control separately, and revoke a browser at any time.": "تبدأ المتصفحات المقترنة للقراءة فقط. اسمح بالكتابة والتحكم بالجلسات كلٌّ على حدة، وألغِ أي متصفح متى شئت.",
    "Private link": "رابط خاص",
    "Traffic goes through a temporary Cloudflare Quick Tunnel. Add an email PIN for a second gate.": "تمر الحركة عبر نفق Cloudflare Quick Tunnel مؤقت. أضف رمز PIN عبر البريد كحماية ثانية.",
    "Remote Control is a beta feature.": "التحكم عن بُعد في مرحلة بيتا.",
    "Built for running several agents at once": "مصمم لتشغيل عدة وكلاء في وقت واحد",
    "Run": "شغّل",
    "Three agents in one grid": "ثلاثة وكلاء في شبكة واحدة",
    "Up to 6 real terminals. Resize, drag, pin or maximize any session, Ctrl+Tab between them.": "حتى ٦ طرفيات حقيقية. غيّر الحجم، واسحب وثبّت وكبّر أي مساحة، وتنقّل بينها بـ Ctrl+Tab.",
    "The dawsha command": "أمر dawsha",
    "Start, resume and open layouts from the terminal you already use.": "ابدأ الجلسات واستأنفها وافتح التخطيطات من طرفيتك المعتادة.",
    "Commit and push": "احفظ التغييرات وارفعها",
    "Review the changed files, commit the ones you pick or commit and push. Pull, switch branch and stash in a click.": "راجع الملفات المتغيرة واختر ما تريد حفظه أو رفعه. اسحب التحديثات وبدّل الفروع واحفظ العمل مؤقتًا بنقرة.",
    "Layouts and instructions": "التخطيطات والتعليمات",
    "Restore a setup by name, and keep CLAUDE.md, AGENTS.md and GEMINI.md in sync.": "استعد ترتيبك المحفوظ بالاسم، وأبقِ ملفات CLAUDE.md وAGENTS.md وGEMINI.md متناسقة.",
    "Arabic support": "دعم العربية",
    "Joined, right-to-left Arabic in every session, with copy and find in reading order.": "عربية متصلة الحروف ومن اليمين إلى اليسار في كل جلسة، مع نسخ وبحث بترتيب القراءة.",
    "Import existing settings": "استيراد إعدادات سابقة",
    "Bring in projects and preferences from an earlier setup, with a backup of your current Dawsha settings.": "انقل مشاريعك وتفضيلاتك من إعداد سابق مع الاحتفاظ بنسخة احتياطية من إعدادات دوشة الحالية.",
    "Back up and move": "انسخ احتياطيًا وانقل",
    "Export your settings to one JSON file without remote-access secrets, then import it on another computer with Merge or Replace.": "صدّر إعداداتك إلى ملف JSON واحد دون أسرار الوصول عن بُعد، ثم استورده على جهاز آخر بخيار الدمج أو الاستبدال.",
    "Themes": "السمات",
    "Seven themes, including card-style light and dark themes, with contrast checks and an optional background image.": "سبع سمات، منها سمات فاتحة وداكنة بتصميم البطاقات، مع فحص للتباين وخيار إضافة صورة خلفية.",
    "Installed skills": "المهارات المثبتة",
    "Browse, open, copy and export skills for every agent, including project skills.": "تصفح مهارات كل وكيل، بما فيها مهارات المشاريع، وافتحها وانسخها أو صدّرها.",
    "Switch": "تنقّل",
    "Remote Control (Beta)": "التحكم عن بُعد (بيتا)",
    "Pair a browser with your running Dawsha app. Input and session controls stay off until you enable them.": "اقرن متصفحًا بتطبيق دوشة المشغّل. يظل إدخال الأوامر والتحكم بالجلسات معطّلَين حتى تفعيلهما.",
    "Resizable Projects panel": "لوحة مشاريع قابلة لتغيير الحجم",
    "Drag the sidebar edge to set a width that suits your projects; Dawsha remembers it.": "اسحب حافة الشريط الجانبي لتختار العرض المناسب لمشاريعك، وسيتذكره دوشة.",
    "Find and resume sessions": "ابحث عن الجلسات واستأنفها",
    "Ctrl+Shift+R searches prompts and replies. Choose the current project or include all projects.": "ابحث في الأسئلة والردود باستخدام Ctrl+Shift+R. اختر المشروع الحالي أو جميع المشاريع.",
    "Keep closed sessions": "احتفظ بالجلسات المغلقة",
    "Closed tabs stay under their project until you remove them there. Resume one whenever you need it.": "تبقى الألسنة المغلقة تحت مشروعها حتى تزيلها منه. يمكنك استئنافها وقتما تشاء.",
    "Project tasks": "مهام المشروع",
    "Keep a task timeline with notes, commit references and linked sessions.": "احتفظ بسجل للمهمة يتضمن الملاحظات ومراجع الالتزامات والجلسات المرتبطة.",
    "Command palette": "لوحة الأوامر",
    "Ctrl+K finds sessions, projects and layouts.": "ابحث عن الجلسات والمشاريع والتخطيطات بـ Ctrl+K.",
    "Find and copy": "ابحث وانسخ",
    "Search any terminal, open files in their matching apps, and copy the last reply or the prompt you are typing.": "ابحث داخل أي مساحة، وافتح الملفات في التطبيق المناسب، وانسخ آخر رد أو سؤالك الجاري.",
    "Ask two agents": "اسأل وكيلين",
    "One prompt, two worktrees, two answers to compare.": "سؤال واحد ومساحتا عمل وإجابتان للمقارنة.",
    "Continue in another agent": "أكمل مع وكيل آخر",
    "Hand a session over with an editable summary, or export it as Markdown.": "انقل الجلسة مع ملخص قابل للتعديل، أو صدّرها بصيغة Markdown.",
    "Stay informed": "تابع كل شيء",
    "Needs-you alerts": "تنبيهات تحتاج تدخلك",
    "An amber border and a notification when a session needs your input.": "إطار كهرماني وتنبيه عندما تنتظر إحدى المساحات ردك.",
    "Close confirmation": "تأكيد الإغلاق",
    "Dawsha asks before closing a session only while it is working. Idle, done and exited sessions close straight away.": "تسألك دوشة قبل إغلاق الجلسة فقط وهي تعمل. أما الجلسات الخاملة والمنتهية والمغلقة فتُغلق فورًا.",
    "Highlights and context": "التمييز والسياق",
    "Errors stand out, and a nearly full session warns you before it runs out.": "الأخطاء واضحة، ويُنبهك التطبيق قبل امتلاء سياق الجلسة.",
    "Reset countdowns": "العد التنازلي لتجديد الحدود",
    "Claude sessions show the 5-hour and weekly reset countdowns when Claude reports them.": "تعرض مساحات Claude الوقت المتبقي لتجديد حدود الخمس ساعات والأسبوع عندما يوفّر Claude وقت التجديد.",
    "Cost and usage": "التكلفة والاستخدام",
    "Time, tokens and cost for every session, plus a full usage view.": "الوقت والرموز والتكلفة لكل مساحة، مع صفحة كاملة للاستخدام.",
    "Gemini tool activity": "نشاط أدوات Gemini",
    "See Gemini's recent tools beside its session.": "اطّلع على أحدث أدوات Gemini بجوار مساحته.",
    "In-app updates": "التحديث داخل التطبيق",
    "The installed build updates itself while sessions keep running.": "تتحدث النسخة المثبتة دون إيقاف جلساتك الجارية.",
    "Local by default": "محلي بشكل افتراضي",
    "No account or telemetry. Remote Control is optional and routes traffic through Cloudflare.": "بلا حساب أو تتبع. التحكم عن بُعد اختياري ويمرّر الحركة عبر Cloudflare.",
    "How it works": "كيف يعمل",
    "Install": "ثبّت",
    "Run the installer or the portable exe. Sign in once to each agent CLI you use, in any terminal.": "شغّل المثبّت أو النسخة المحمولة. سجّل الدخول إلى أدوات الوكلاء التي تستخدمها مرة واحدة.",
    "Add projects": "أضف مشاريعك",
    "Pick a folder and a default agent. A short first-run setup shows which CLIs it found.": "اختر مجلدًا ووكيلًا افتراضيًا. يوضح الإعداد الأولي الأدوات التي وجدها التطبيق.",
    "Start sessions": "ابدأ الجلسات",
    "Press Ctrl+N, or run": "اضغط Ctrl+N أو شغّل",
    "in a folder. Each agent runs in its own terminal.": "داخل مجلد. يعمل كل وكيل في مساحته الخاصة.",
    "Stay on top": "ابقَ على اطلاع",
    "Glance at status, plans and context. Come back when a session needs your input.": "تابع الحالة والخطط والسياق، وعد عندما تحتاج إحدى المساحات إليك.",
    "The": "أمر",
    "command": "",
    "The installer adds it to your PATH. Open a new terminal and drive Dawsha from where you already work.": "يضيفه المثبّت إلى PATH. افتح طرفية جديدة وتحكم في دوشة من مكان عملك المعتاد.",
    "Download Dawsha": "حمّل دوشة",
    "Latest release": "أحدث إصدار",
    ", Windows 10/11 x64, Apple Silicon Mac and Linux x64. Free under the MIT licence.": "، لويندوز 10/11 بمعمارية x64 وماك بمعالج Apple Silicon ولينكس x64. مجاني برخصة MIT.",
    "Windows": "ويندوز",
    "Windows 10 or 11 · x64": "ويندوز 10 أو 11 · x64",
    "Download installer": "تنزيل المثبّت",
    ".exe · Recommended": ".exe · موصى به",
    "Download portable": "تنزيل النسخة المحمولة",
    ".exe": ".exe",
    "macOS": "macOS",
    "Apple Silicon · macOS 13 or later": "Apple Silicon · macOS 13 أو أحدث",
    "Download for macOS": "تنزيل لنظام macOS",
    "Linux": "لينكس",
    "x64 · AppImage or Debian / Ubuntu": "x64 · AppImage أو ديبيان / أوبونتو",
    "Download AppImage": "تنزيل AppImage",
    "Download Debian / Ubuntu": "تنزيل ديبيان / أوبونتو",
    "Linux packages appear here after the first Linux release. If a package is unavailable, the link opens the latest release.": "تظهر حزم لينكس هنا بعد نشر أول إصدار له. إذا لم تتوفر الحزمة، يفتح الرابط أحدث إصدار.",
    "SmartScreen.": "حماية ويندوز.",
    "The builds are not code signed, so Windows may show \"Windows protected your PC\". Choose": "الإصدارات غير موقّعة رقميًا، لذلك قد يعرض ويندوز تحذير حماية. اختر",
    "More info": "مزيد من المعلومات",
    ", then": "، ثم",
    "Run anyway": "تشغيل على أي حال",
    ".": ".",
    "Requirements.": "المتطلبات.",
    "Windows 10 or 11 (x64), an Apple Silicon Mac with macOS 13 or later, or Linux (x64). Install the agent CLIs you want to use: Claude Code, Codex CLI, Gemini CLI. Node.js 20+ is only needed to install Codex and Gemini from inside Dawsha.": "ويندوز 10 أو 11 بمعمارية x64، أو ماك بمعالج Apple Silicon وmacOS 13 أو أحدث، أو لينكس بمعمارية x64. ثبّت أدوات الوكلاء التي تريدها: Claude Code وCodex CLI وGemini CLI. تحتاج Node.js 20+ فقط لتثبيت Codex وGemini من داخل دوشة.",
    "Stop hunting for the right window.": "لا تبحث عن النافذة المناسبة بعد الآن.",
    "Put every agent where you can read it.": "ضع كل وكيل أمام عينيك.",
    "View on GitHub": "اعرضه على GitHub",
    "Changelog": "سجل التغييرات",
    "MIT licence": "رخصة MIT"
  };

  const attributeTranslations = {
    "Dawsha home": "الصفحة الرئيسية لدوشة",
    "Primary": "التنقل الرئيسي",
    "Dawsha with the Projects sidebar on the left and a Claude Code session on the right, working on a dark mode toggle in a sample project": "دوشة: شريط المشاريع على اليسار وجلسة Claude Code على اليمين تعمل على مفتاح الوضع الداكن في مشروع تجريبي",
    "A 20 second tour: four agent windows become one Dawsha grid, an amber border marks the session that needs you, Ctrl+K opens the palette, and Remote Control answers from a phone": "جولة في 20 ثانية: أربع نوافذ للوكلاء تصبح شبكة واحدة في دوشة، وإطار كهرماني يميز الجلسة التي تحتاجك، وCtrl+K يفتح لوحة الأوامر، والتحكم عن بُعد يرد من الهاتف",
    "Pause the demo": "إيقاف العرض مؤقتًا",
    "Three agents moving into one window": "ثلاثة وكلاء يدخلون نافذة واحدة",
    "The Agents tab with eight built-in agents, one agent of your own called Zed, and the setup of Sami the code reviewer on the right": "تبويب الوكلاء مع ثمانية وكلاء مدمجين، ووكيل خاص باسم Zed، وإعدادات Sami مراجع الشيفرة على اليمين",
    "The Run Sami dialog with a target field, the project, a choice of model for this run and a preview of the command": "نافذة تشغيل Sami مع حقل الهدف والمشروع واختيار النموذج لهذه المرة ومعاينة للأمر",
    "Four sessions titled with agent names, such as Sami · PR 8841, each with its avatar, and a strip in the top bar showing who is working and who needs you": "أربع جلسات بعناوين تحمل أسماء الوكلاء مثل Sami · PR 8841، لكل منها صورة وكيلها، وشريط في الأعلى يبيّن من يعمل ومن يحتاجك",
    "Maya's plan with three jobs for Omar, Hana and Sami, each with a model and an estimated cost, and the buttons Cancel, Change the plan and Approve and start": "خطة Maya بثلاث مهام لـ Omar وHana وSami، لكل منها نموذج وتكلفة مقدّرة، مع الأزرار إلغاء وتغيير الخطة والموافقة والبدء",
    "The board with three lanes, Omar needing you, Hana working and Sami waiting, and a question from Maya about pushing the branch with two answer buttons": "اللوحة بثلاثة مسارات: Omar يحتاجك وHana تعمل وSami تنتظر، وسؤال من Maya عن دفع الفرع بزرّي إجابة",
    "The Agents tab of Dawsha Remote on a phone, with eight agents, three of them working, needing you or done, and the jobs running now": "تبويب الوكلاء في دوشة عن بُعد على الهاتف، بثمانية وكلاء منهم من يعمل ومن يحتاجك ومن أنهى، والمهام الجارية الآن",
    "The Remote Access page on the PC, reporting that your phone can reach this PC, with a pairing code, the connection details and your phones": "صفحة الوصول عن بُعد على الحاسوب تفيد بأن هاتفك يصل إليه، مع رمز الاقتران وتفاصيل الاتصال وهواتفك",
    "The Projects sidebar in zones: an Active section of project cards, a pinned project, and a quiet list headed No sessions with the number of projects": "شريط المشاريع الجانبي في مناطق: قسم نشط ببطاقات المشاريع، ومشروع مثبّت، وقائمة هادئة بعنوان «بلا جلسات» مع عدد المشاريع",
    "Files with the Problems tab open under the editor, listing two TypeScript errors and a warning grouped by file": "عرض الملفات وتبويب المشكلات مفتوح تحت المحرر، يسرد خطأين من TypeScript وتحذيرًا مجمّعة بحسب الملف",
    "The New session dialog with project cards on the left and Claude, Codex and Gemini cards with versions and limit bars on the right": "نافذة الجلسة الجديدة: المشاريع على اليسار وبطاقات Claude وCodex وGemini بالإصدارات وأشرطة الحدود على اليمين",
    "A maximized session with the Other sessions panel on the right showing live previews of three more sessions": "جلسة مكبرة ولوحة الجلسات الأخرى على اليمين بمعاينة مباشرة لثلاث جلسات أخرى",
    "The resume picker listing earlier sessions of all three agents with a preview of the selected one": "قائمة استئناف جلسات الوكلاء الثلاثة مع معاينة الجلسة المحددة",
    "The command palette filtered by a short query, listing sessions, actions and projects": "لوحة الأوامر تعرض الجلسات والإجراءات والمشاريع",
    "Two agents answering the same prompt side by side, each in its own worktree, with Keep A, Keep B and Diff buttons": "وكيلان يجيبان على السؤال نفسه جنبًا إلى جنب في مساحتي عمل منفصلتين",
    "The Usage view with tokens per day by agent, limit history and tables by project and by agent": "صفحة الاستخدام تعرض الرموز اليومية وسجل الحدود حسب المشروع والوكيل",
    "Dawsha Skills tab showing installed Claude, Codex, Gemini and shared skills with their locations": "تبويب المهارات في دوشة يعرض مهارات Claude وCodex وGemini والمهارات المشتركة ومواقعها",
    "Dawsha Skills tab showing installed agent definitions with their locations": "تبويب المهارات في دوشة يعرض تعريفات الوكلاء المثبتة ومواقعها",
    "Dawsha Remote on a phone showing the Approvals tab with three agents waiting, each with Allow once and Deny buttons, and a file edit that can only be denied": "دوشة عن بُعد على الهاتف تعرض تبويب الموافقات وثلاثة وكلاء ينتظرون، لكل منها زرا السماح مرة واحدة والرفض، مع تعديل ملف لا يمكن إلا رفضه",
    "Dawsha Remote on a phone showing a Claude Code reply with numbered steps and a code block, above a message box": "دوشة عن بُعد على الهاتف تعرض رد Claude Code بخطوات مرقمة ومقطع كود، فوق مربع الرسالة",
    "Dawsha logo": "شعار دوشة",
    "dawsha command examples": "أمثلة لأوامر دوشة"
  };

  const NAMES = /(Claude Code|Codex CLI|Gemini CLI|Claude|Codex|Gemini)/g;
  const isolate = (text) => text.replace(NAMES, '\u2068$1\u2069');
  for (const table of [translations, attributeTranslations]) {
    for (const key of Object.keys(table)) table[key] = isolate(table[key]);
  }

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
  const arabicTitle = 'دوشة: كل وكلاء البرمجة في نافذة واحدة';
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
    document.querySelectorAll('[data-poster-ar]').forEach((element) => {
      if (!element.hasAttribute('data-poster-en')) element.setAttribute('data-poster-en', element.getAttribute('poster'));
      element.setAttribute('poster', arabic ? element.getAttribute('data-poster-ar') : element.getAttribute('data-poster-en'));
    });
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
