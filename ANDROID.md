# Slop New York — versi Android

Remix dari [Slop New York](https://mrdoob.github.io/slop-newyork/) karya Mr.doob (lisensi MIT, lihat `LICENSE`),
dioptimasi untuk HP Android.

## Yang diubah dari versi asli

- **Grafik otomatis menyesuaikan HP** (`js/quality.js`): HP biasa → *Low*, HP flagship → *Medium*, PC → *High* (= asli).
  Bisa diganti di menu ⚙️ Settings.
  - Low: tanpa bayangan matahari & pantulan (SSR), tanpa MSAA (diganti FXAA), mobil 70 (asli 200),
    pejalan kaki 110 (asli 340), lampu & detail jarak jauh dikurangi.
  - Jarak pandang mengikuti kabut (Low & Medium): kabut sedikit lebih tebal, dan kota di balik kabut yang sudah
    pekat tidak digambar sama sekali (−15% draw call, −10% waktu CPU render, diukur).
  - Loading lebih cepat: kompilasi shader 16 sekaligus (10,1 dtk → 5,6 dtk di PC, diukur), tanpa menyiapkan
    bayangan kalau bayangan mati.
  - Resolusi dinamis: kalau FPS turun, resolusi otomatis diturunkan sedikit; naik lagi kalau lancar.
  - FPS dikunci 60 (HP 90/120 Hz tidak panas), radar digambar 30 Hz, game berhenti saat HP tegak (hemat baterai).
- **UI baru** (`css/hud.css`): radar bulat kiri atas, mode (Jalan / Mobil / Sepeda / Heli) di tengah atas,
  4 tombol bulat kanan atas (Teleport, Peta, Kamera, Settings), speedometer di tengah bawah. Link GitHub dihapus.
- **Kontrol sentuh**: joystick kiri + tombol kanan yang berubah sesuai mode
  (Mobil: GAS / BRAKE / HORN · Sepeda: PEDAL / BRAKE · Jalan: JUMP / RUN · Heli: FWD / UP / DOWN). Geser layar = putar kamera.
- **Wajib landscape**: kalau HP tegak muncul layar "Rotate your phone". Tombol *Tap to play* setelah loading
  langsung masuk fullscreen + mengunci landscape.
- **Bisa di-install** seperti aplikasi (PWA: `manifest.webmanifest`, `sw.js`, ikon di `icons/`).

## Cara main di HP

WebGPU di Chrome Android hanya aktif di alamat **https** (atau `localhost`), jadi:

1. **Paling gampang:** upload folder ini ke hosting https gratis (GitHub Pages, Netlify, Cloudflare Pages),
   buka linknya di Chrome Android → menu ⋮ → *Add to Home screen*. Setelah itu bisa dibuka seperti aplikasi.
2. **Tes lewat kabel USB:** jalankan server di PC, lalu `adb reverse` supaya HP bisa membuka `localhost`:

   ```bash
   python -m http.server 8765
   ```

   ```bash
   adb reverse tcp:8765 tcp:8765
   ```

   Lalu buka `http://localhost:8765` di Chrome HP.

## Atur sendiri lewat URL

Tambahkan parameter di link untuk mencoba setelan: `?quality=low&shadows=1&cars=90&renderScale=0.7`
(semua nama setelan ada di `js/quality.js`).

## Mengukur performa

Buka dengan `?profile=1`, lalu di console:

- `__perf.report()` — rata-rata waktu per sistem per frame (CPU, GPU, draw call, segitiga).
- `await __app.bench()` — render 5 sudut pandang tetap dan ukur CPU/GPU-nya; angkanya bisa dibandingkan sebelum/sesudah
  perubahan karena tidak tergantung FPS browser.
