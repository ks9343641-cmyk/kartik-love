/*
 * Wind leaves: heart-shaped leaves that drift and flutter across the WHOLE screen,
 * including the area where the typewriter text is written.
 * It lives on two extra canvases and does not touch the tree code in love.js:
 *   - "back" canvas sits behind the text (most leaves, so reading stays easy)
 *   - "front" canvas sits above the text (a few small, slightly see-through leaves)
 *
 * Start it with:  startWindLeaves();
 *
 * Quick tuning (change only these numbers):
 *   WIND_DENSITY   1 = normal, 0.5 = fewer leaves, 1.5 = more leaves
 *   WIND_SPEED     1 = normal, 0.7 = slower, 1.3 = faster
 */
(function () {
    var WIND_DENSITY = 1;
    var WIND_SPEED = 1;

    var COLORS = ['#ff6b81', '#ff4757', '#e84393', '#fd79a8', '#c0392b', '#eb2f06'];
    var FADE_IN_MS = 3000;   // leaves appear softly, not all at once
    var started = false;

    var W = 0, H = 0, dpr = 1;
    var back, front, backCtx, frontCtx;
    var leaves = [];
    var t0 = 0, lastTs = 0, clock = 0;

    // Heart outline (about 32 x 29 units), drawn once and reused for every leaf.
    var heart = new Path2D();
    (function () {
        for (var a = 0; a <= Math.PI * 2 + 0.01; a += 0.1) {
            var x = 16 * Math.pow(Math.sin(a), 3);
            var y = -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) - 2.5;
            if (a === 0) { heart.moveTo(x, y); } else { heart.lineTo(x, y); }
        }
        heart.closePath();
    })();

    function rand(min, max) { return min + Math.random() * (max - min); }

    function makeCanvas(zIndex, id) {
        var c = document.createElement('canvas');
        c.id = id;
        c.style.position = 'fixed';
        c.style.left = '0';
        c.style.top = '0';
        c.style.width = '100%';
        c.style.height = '100%';
        c.style.pointerEvents = 'none';
        c.style.zIndex = String(zIndex);
        document.body.appendChild(c);
        return c;
    }

    function resize() {
        W = window.innerWidth;
        H = window.innerHeight;
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        [back, front].forEach(function (c) {
            c.width = Math.round(W * dpr);
            c.height = Math.round(H * dpr);
        });
    }

    function makeLeaf(layer, anywhere) {
        var small = layer === 1;                              // layer 1 = front (above text)
        var size = small ? rand(0.28, 0.42) : rand(0.36, 0.8);
        return {
            layer: layer,
            size: size,
            x: rand(-60, W + 60),
            y: anywhere ? rand(-30, H + 30) : rand(-120, -30),
            vx: 0,
            vy: rand(0.45, 0.8) + size * 0.5,                 // slow fall, bigger leaves a bit faster
            phase: rand(0, Math.PI * 2),
            phaseSpeed: rand(0.012, 0.03),
            swayAmp: rand(0.5, 1.3),
            rot: rand(0, Math.PI * 2),
            rotSpeed: rand(-0.012, 0.012),
            flip: rand(0, Math.PI * 2),
            flipSpeed: rand(0.025, 0.06),
            weight: rand(0.6, 1.4),                           // how strongly the wind pushes this leaf
            color: COLORS[Math.floor(Math.random() * COLORS.length)],
            alpha: small ? rand(0.7, 0.85) : rand(0.55, 0.95)
        };
    }

    function buildLeaves() {
        var total = Math.round(Math.max(16, Math.min(46, (W * H) / 38000)) * WIND_DENSITY);
        var frontCount = Math.max(4, Math.round(total * 0.25));
        leaves = [];
        for (var i = 0; i < total; i++) {
            leaves.push(makeLeaf(i < frontCount ? 1 : 0, true));
        }
    }

    // Gentle breeze with slow gusts. During a gust light leaves also lift up a little.
    function windAt(t) {
        var g = Math.sin(t * 0.35) * 0.5 + Math.sin(t * 0.9 + 1.7) * 0.25 + Math.sin(t * 0.13 + 0.6) * 0.5;
        return {
            x: (0.35 + g * 0.9) * WIND_SPEED,
            lift: Math.max(0, Math.sin(t * 0.35 + 0.8)) * 0.5 * WIND_SPEED
        };
    }

    function update(l, dt, wind) {
        l.vx += (wind.x * l.weight - l.vx) * 0.04 * dt;       // leaf follows the wind smoothly
        l.x += (l.vx + Math.sin(l.phase) * l.swayAmp) * dt * WIND_SPEED;
        l.y += (l.vy * WIND_SPEED - wind.lift * l.weight * 0.9) * dt;
        l.phase += l.phaseSpeed * dt;
        l.rot += l.rotSpeed * dt;
        l.flip += l.flipSpeed * dt;

        if (l.y > H + 40) {                                   // gone below -> new leaf from above
            l.y = rand(-120, -30);
            l.x = rand(-60, W + 60);
        } else if (l.y < -160) {
            l.y = -40;
        }
        if (l.x > W + 70) { l.x = -60; }
        else if (l.x < -70) { l.x = W + 60; }
    }

    function drawLeaf(ctx, l, fade) {
        var squash = 0.3 + 0.7 * Math.abs(Math.cos(l.flip)); // turning in the air
        ctx.save();
        ctx.globalAlpha = l.alpha * fade;
        ctx.fillStyle = l.color;
        ctx.translate(l.x, l.y);
        ctx.rotate(l.rot + Math.sin(l.phase * 1.3) * 0.6);
        ctx.scale(l.size * squash, l.size);
        ctx.fill(heart);
        ctx.restore();
    }

    function frame(ts) {
        if (!lastTs) { lastTs = ts; }
        var dt = Math.min((ts - lastTs) / 16.667, 3);         // frame-rate independent, capped after tab switch
        lastTs = ts;
        clock += dt / 60;

        var p = Math.min((ts - t0) / FADE_IN_MS, 1);
        var fade = p * p * (3 - 2 * p);
        var wind = windAt(clock);

        backCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        frontCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        backCtx.clearRect(0, 0, W, H);
        frontCtx.clearRect(0, 0, W, H);

        for (var i = 0; i < leaves.length; i++) {
            var l = leaves[i];
            update(l, dt, wind);
            drawLeaf(l.layer === 1 ? frontCtx : backCtx, l, fade);
        }
        requestAnimationFrame(frame);
    }

    window.startWindLeaves = function () {
        if (started) { return; }
        started = true;
        back = makeCanvas(1, 'wind-back');     // above the tree, below the text (text is z-index 2)
        front = makeCanvas(3, 'wind-front');   // above the text
        backCtx = back.getContext('2d');
        frontCtx = front.getContext('2d');
        resize();
        buildLeaves();
        window.addEventListener('resize', resize);
        t0 = performance.now();
        requestAnimationFrame(frame);
    };
})();
