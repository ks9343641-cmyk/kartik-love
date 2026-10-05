/*
 * Wind leaves: heart-shaped leaves that drift and flutter across the WHOLE screen,
 * including the area where the typewriter text is written.
 *
 * Built to be light on phones and laptops:
 *   - every leaf is a tiny element moved with GPU transforms (no full-screen canvas,
 *     no full-screen clearing every frame)
 *   - it starts only after the black -> pink transition has finished
 *   - if a device turns out to be slow, it quietly drops some leaves
 *
 * Two layers: "back" sits behind the text (most leaves, so reading stays easy),
 * "front" sits above the text (a few small, slightly see-through leaves).
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
    var START_DELAY_MS = 1500; // wait until the background fade (1.2 s) is finished
    var FADE_IN_MS = 3000;     // leaves appear softly, not all at once
    var started = false;

    var W = 0, H = 0;
    var backBox, frontBox;
    var leaves = [];
    var t0 = 0, lastTs = 0, clock = 0;
    var slowFrames = 0, checkedFrames = 0, degradeStep = 0, nextCheck = 0;

    // Heart outline built once from the heart formula, plus its size, so every leaf keeps the right proportions.
    var HEART = (function () {
        var pts = [], minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
        for (var a = 0; a <= Math.PI * 2 + 0.01; a += 0.1) {
            var x = 16 * Math.pow(Math.sin(a), 3);
            var y = -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a));
            pts.push([x, y]);
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
        var d = '';
        for (var i = 0; i < pts.length; i++) {
            d += (i === 0 ? 'M' : 'L') + pts[i][0].toFixed(2) + ' ' + pts[i][1].toFixed(2);
        }
        return { path: d + 'Z', x: minX - 1, y: minY - 1, w: maxX - minX + 2, h: maxY - minY + 2 };
    })();

    // One small SVG picture per colour (crisp at any size). Pre-loaded right away so nothing has to be decoded mid-animation.
    var SRC = {};
    COLORS.forEach(function (c) {
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + HEART.x + ' ' + HEART.y + ' ' + HEART.w + ' ' + HEART.h +
                  '"><path d="' + HEART.path + '" fill="' + c + '"/></svg>';
        SRC[c] = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        new Image().src = SRC[c];
    });

    function rand(min, max) { return min + Math.random() * (max - min); }

    function makeBox(zIndex, id) {
        var box = document.createElement('div');
        box.id = id;
        box.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:' + zIndex + ';';
        document.body.appendChild(box);
        return box;
    }

    function makeLeaf(layer, anywhere) {
        var small = layer === 1;                              // layer 1 = front (above text)
        var size = small ? rand(0.28, 0.42) : rand(0.36, 0.8);
        var color = COLORS[Math.floor(Math.random() * COLORS.length)];
        var w = 32 * size, h = w * HEART.h / HEART.w;
        var el = new Image();
        el.src = SRC[color];
        el.alt = '';
        el.draggable = false;
        el.style.cssText = 'position:absolute;left:0;top:0;display:block;opacity:0;will-change:transform;' +
                           'width:' + w.toFixed(1) + 'px;height:' + h.toFixed(1) + 'px;';
        (small ? frontBox : backBox).appendChild(el);
        return {
            el: el, layer: layer, w: w, h: h,
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
            alpha: small ? rand(0.7, 0.85) : rand(0.55, 0.95)
        };
    }

    function buildLeaves() {
        var total = Math.round(Math.max(16, Math.min(46, (W * H) / 38000)) * WIND_DENSITY);
        var frontCount = Math.max(4, Math.round(total * 0.25));
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

    function step(l, dt, wind) {
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

    function paint(l) {
        var squash = 0.3 + 0.7 * Math.abs(Math.cos(l.flip)); // turning in the air
        var ang = l.rot + Math.sin(l.phase * 1.3) * 0.6;
        l.el.style.transform = 'translate3d(' + (l.x - l.w / 2).toFixed(1) + 'px,' + (l.y - l.h / 2).toFixed(1) + 'px,0) rotate(' +
                               ang.toFixed(3) + 'rad) scale(' + squash.toFixed(3) + ',1)';
    }

    // If the device is struggling, quietly remove some leaves (never on a normal laptop/phone).
    function adaptToSpeed(rawDt, ts) {
        if (degradeStep >= 2) { return; }
        checkedFrames++;
        if (rawDt > 45) { slowFrames++; }
        if (ts >= nextCheck) {
            if (checkedFrames > 20 && slowFrames / checkedFrames > 0.5) {
                degradeStep++;
                var target = Math.max(8, Math.round(leaves.length * 0.65));
                while (leaves.length > target) {
                    var gone = leaves.pop();
                    if (gone.el.parentNode) { gone.el.parentNode.removeChild(gone.el); }
                }
            }
            slowFrames = 0; checkedFrames = 0; nextCheck = ts + 3000;
        }
    }

    function frame(ts) {
        if (!lastTs) { lastTs = ts; }
        var rawDt = ts - lastTs;
        var dt = Math.min(rawDt / 16.667, 3);                 // frame-rate independent, capped after tab switch
        lastTs = ts;
        clock += dt / 60;

        var p = Math.min((ts - t0) / FADE_IN_MS, 1);
        var fade = p * p * (3 - 2 * p);
        var wind = windAt(clock);
        var fading = p < 1;
        var justFinished = !fading && !frame.done;
        if (justFinished) { frame.done = true; }

        for (var i = 0; i < leaves.length; i++) {
            var l = leaves[i];
            step(l, dt, wind);
            paint(l);
            if (fading || justFinished) { l.el.style.opacity = (l.alpha * fade).toFixed(3); }
        }
        if (ts > t0 + FADE_IN_MS) { adaptToSpeed(rawDt, ts); }
        requestAnimationFrame(frame);
    }

    function init() {
        W = window.innerWidth;
        H = window.innerHeight;
        backBox = makeBox(1, 'wind-back');     // above the tree, below the text (text is z-index 2)
        frontBox = makeBox(3, 'wind-front');   // above the text
        buildLeaves();
        window.addEventListener('resize', function () { W = window.innerWidth; H = window.innerHeight; });
        t0 = performance.now();
        nextCheck = t0 + FADE_IN_MS + 3000;
        requestAnimationFrame(frame);
    }

    window.startWindLeaves = function () {
        if (started) { return; }
        started = true;
        setTimeout(init, START_DELAY_MS);
    };
})();
