(function () {
  var API = 'https://api.github.com/repos/mfathy234/dawsha/releases/latest';
  // Offer the visitor's own platform first. Without JavaScript the button stays on the Windows installer.
  var ar = document.documentElement.lang === 'ar';
  var PLATFORMS = {
    mac: { dl: 'mac', title: ar ? 'تنزيل لنظام macOS' : 'Download for macOS', meta: ar ? 'Apple Silicon · ملف DMG' : 'Apple Silicon · DMG disk image' },
    linux: { dl: 'linux-appimage', title: ar ? 'تنزيل لنظام لينكس' : 'Download for Linux', meta: ar ? 'x64 · AppImage' : 'x64 · AppImage' }
  };
  function detectPlatform() {
    var hint = String((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || '');
    if (/android|iphone|ipad/i.test(navigator.userAgent || '')) return 'windows';
    if (/mac/i.test(hint)) return 'mac';
    if (/linux|x11/i.test(hint)) return 'linux';
    return 'windows';
  }
  var platform = detectPlatform();
  var main = document.querySelector('[data-main-download]');
  if (main && PLATFORMS[platform]) {
    var choice = PLATFORMS[platform];
    var alt = document.querySelector('.download-alt-link[data-dl="' + choice.dl + '"]');
    var altIcon = alt && alt.querySelector('.platform-icon');
    var mainIcon = main.querySelector('.platform-icon');
    if (altIcon && mainIcon) mainIcon.replaceWith(altIcon.cloneNode(true));
    main.setAttribute('data-dl', choice.dl);
    main.querySelector('.download-title').textContent = choice.title;
    main.querySelector('.download-meta-text').textContent = choice.meta;
    if (alt) alt.hidden = true;
    var winInstaller = document.querySelector('.download-alt-link[data-platform="windows"][data-dl="setup"]');
    if (winInstaller) winInstaller.hidden = false;
  }
  document.documentElement.setAttribute('data-platform', platform);

  fetch(API, { headers: { Accept: 'application/vnd.github+json' } })
    .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error(String(r.status))); })
    .then(function (rel) {
      var version = String(rel.tag_name || '').replace(/^v/, '');
      var assets = rel.assets || [];
      function find(re) {
        for (var i = 0; i < assets.length; i++) {
          if (re.test(assets[i].name)) return assets[i].browser_download_url;
        }
        return null;
      }
      var urls = {
        setup: find(/setup.*\.exe$/i),
        portable: find(/portable.*\.exe$/i),
        mac: find(/mac-arm64\.dmg$/i),
        'linux-appimage': find(/linux-x86_64\.AppImage$/i),
        'linux-deb': find(/linux-amd64\.deb$/i)
      };
      document.querySelectorAll('[data-dl]').forEach(function (a) {
        var url = urls[a.getAttribute('data-dl')];
        if (url && /^https:\/\/github\.com\/mfathy234\/dawsha\/releases\/download\//.test(url)) a.href = url;
      });
      var macCard = document.querySelector('[data-platform-card="mac"]');
      if (macCard && urls.mac) macCard.hidden = false;
      if (version) {
        document.querySelectorAll('[data-version-tag]').forEach(function (el) {
          el.textContent = 'v' + version;
        });
        document.querySelectorAll('[data-version]').forEach(function (el) {
          el.textContent = (document.documentElement.lang === 'ar' ? 'الإصدار ' : 'Version ') + version;
        });
      }
    })
    .catch(function () {});
})();
