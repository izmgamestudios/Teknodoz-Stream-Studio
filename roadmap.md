# Roadmap
- [x] Kameralı A/B podcast prompter (yapıştır, .docx, .txt)
- [x] Masaüstü/ekran paylaşımı + kamera ile kayıt (tek bilgisayar)
- [x] Stüdyo: taslak + canlı/kayıt bölümü, sürükle-bırak logo/banner/yazı, altyazı, arka plan video/müzik, ses efekti, görüntü efekti
- [x] Stüdyo (epic-sagan hattı): sahneler/katmanlar, oda, canlı yayın, topluluk, PWA, kılavuz
- [x] 31 WebGL geçişi (gl-transitions, MIT) sahne geçişi olarak seçilebilir
- [x] Ses kütüphanesi: kodla üretilen 5 lo-fi/ambient parça + 12 sentezlenmiş efekt (Alt+1…8), telifsiz
- [x] Mobil: alt eylem çubuğu (önceki/sonraki sahne, kayıt)
- [ ] CC0 ses paketleri (Kenney/Freesound) `public/sfx` altına (bu ortamdan indirilemedi)
- [ ] Sahne geçişi sırasında otomatik whoosh efekti
- [x] Klasik Stüdyo (`/classic`): solda düzenle / sağda canlı, 8 şablon, sahne listesi, PeerJS telefon kumandası (`/classic/remote`), konuk daveti (`/classic/join`), mobil prompter (`/classic/prompter`)
- [x] Senkron: prompter metni (ana Stüdyo ⇄ Klasik ⇄ diğer sekmeler) ve Klasik sahnelerini ana Stüdyo'ya aktarma (anında, açık sekmeye)
- [x] Dikey/kare/portre çıkış (9:16, 4:5, 1:1, 4:3): sahneler otomatik uyarlanır, güvenli bölge, kayıt öncesi geri sayım, canlı yayın kalitesi formata uyar; Klasik Stüdyo'da da
- [x] Kamera/görüntü ayarları (parlaklık, kontrast, doygunluk, ton, netlik, bulanıklık, sıcaklık, vinyet) + 12 ön ayar
- [x] Ses iyileştirme: gürültü kapısı (AudioWorklet), EQ, sıkıştırıcı, limiter, ortam gürültüsü ölçümü, otomatik müzik kısma (ducking)
- [x] 10 yeni şablon (röportaj, radyo, 5 dikey, 4:5, 2 kare) + 4 yeni Klasik şablon
- [ ] Yapay zeka tabanlı gürültü bastırma (RNNoise/WASM) ve arka plan bulanıklaştırma (segmentasyon): model dosyaları bu ortamdan indirilemedi

