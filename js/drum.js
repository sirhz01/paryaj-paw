/* Tambour à boules animé (canvas) pour Lucky Six et Lucky X. */
PP.drum = function (canvas, count = 30) {
  const ctx = canvas.getContext('2d');
  const size = 600; canvas.width = canvas.height = size;
  const R = size / 2 - 8, br = 17;
  const balls = Array.from({ length: count }, (_, i) => {
    const a = Math.random() * 6.283, d = Math.random() * (R - br);
    return { x: size / 2 + Math.cos(a) * d, y: size / 2 + Math.sin(a) * d, vx: (Math.random() - .5) * 7, vy: (Math.random() - .5) * 7, c: PP.COLORS[(i % 7) + 1] };
  });
  let running = true, speed = 1;

  function frame() {
    if (!running) return;
    ctx.clearRect(0, 0, size, size);
    const g = ctx.createRadialGradient(size / 2, size / 2, R * .2, size / 2, size / 2, R);
    g.addColorStop(0, 'rgba(8,20,40,.85)'); g.addColorStop(1, 'rgba(0,0,0,.95)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(size / 2, size / 2, R, 0, 6.283); ctx.fill();
    for (const b of balls) {
      b.vy += .08 * speed;
      b.x += b.vx * speed; b.y += b.vy * speed;
      const dx = b.x - size / 2, dy = b.y - size / 2, d = Math.hypot(dx, dy);
      if (d > R - br) {                       // rebond sur la paroi
        const nx = dx / d, ny = dy / d, dot = b.vx * nx + b.vy * ny;
        b.vx = (b.vx - 2 * dot * nx) * .99 + (Math.random() - .5) * 2; b.vy = (b.vy - 2 * dot * ny) * .99 - Math.random() * 3;
        b.x = size / 2 + nx * (R - br); b.y = size / 2 + ny * (R - br);
      }
      const s = Math.hypot(b.vx, b.vy); if (s > 11) { b.vx *= 11 / s; b.vy *= 11 / s; }
      const bg = ctx.createRadialGradient(b.x - 5, b.y - 6, 2, b.x, b.y, br);
      bg.addColorStop(0, '#fff'); bg.addColorStop(.25, b.c); bg.addColorStop(1, 'rgba(0,0,0,.6)');
      ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(b.x, b.y, br, 0, 6.283); ctx.fill();
    }
    ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(210,225,240,.85)';
    ctx.beginPath(); ctx.arc(size / 2, size / 2, R, 0, 6.283); ctx.stroke();
    requestAnimationFrame(frame);
  }
  frame();
  return { setSpeed(v) { speed = v; }, stop() { running = false; }, start() { if (!running) { running = true; frame(); } } };
};
