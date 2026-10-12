(function () {
  document.querySelectorAll('.platform-picker').forEach(function (picker) {
    picker.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        picker.open = false;
        picker.querySelector('summary').focus();
      }
    });
    document.addEventListener('click', function (event) {
      if (!picker.contains(event.target)) picker.open = false;
    });
  });
  var API = 'https://api.github.com/repos/mfathy234/dawsha/releases/latest';
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
        'linux-appimage': find(/linux-x64\.AppImage$/i),
        'linux-deb': find(/linux-x64\.deb$/i)
      };
      document.querySelectorAll('[data-dl]').forEach(function (a) {
        var url = urls[a.getAttribute('data-dl')];
        if (url && /^https:\/\/github\.com\/mfathy234\/dawsha\/releases\/download\//.test(url)) a.href = url;
      });
      var macCard = document.querySelector('[data-platform-card="mac"]');
      if (macCard && urls.mac) macCard.hidden = false;
      if (version) {
        document.querySelectorAll('[data-version]').forEach(function (el) {
          el.textContent = (document.documentElement.lang === 'ar' ? 'الإصدار ' : 'Version ') + version;
        });
      }
    })
    .catch(function () {});
})();
