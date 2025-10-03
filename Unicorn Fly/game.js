(() => {
    const canvas = document.getElementById('game');
    const ctx = canvas.getContext('2d');

    // HiDPI scaling for crisp rendering
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    function resizeCanvas() {
        const cssWidth = canvas.clientWidth || canvas.width;
        const cssHeight = canvas.clientHeight || canvas.height;
        canvas.width = Math.floor(cssWidth * dpr);
        canvas.height = Math.floor(cssHeight * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Game constants
    const world = {
        width: canvas.width / dpr,
        height: canvas.height / dpr,
        groundHeight: 0,
        gravity: 1200,
        jumpImpulse: -360,
        pipeSpeed: 140,
        pipeGap: 160,
        pipeSpacing: 210,
        pipeWidth: 70
    };
    // Store defaults to allow resets
    world.basePipeSpeed = world.pipeSpeed;

	// Player sprite (optional image)
	const sprite = {
		img: new Image(),
		loaded: false,
		drawW: 84,
		drawH: 70,
		url: 'assets/unicorn.png'
	};
	// Cloud obstacle sprite (replaces green pipes)
	const cloudSprite = {
		img: new Image(),
		loaded: false,
		url: 'assets/cloud.png'
	};
	cloudSprite.img.onload = () => { cloudSprite.loaded = true; };
	cloudSprite.img.onerror = () => { cloudSprite.loaded = false; };
	try { cloudSprite.img.src = cloudSprite.url; } catch {}

	// Visual and collision sizing for clouds
	const cloudVisual = {
		baseWScale: 1.7, // relative to opening width
		baseH: 130,
		overlap: 18, // how much clouds overlap into the gap
		// ellipse radii factors (relative to draw width/height)
		rxFactor: 0.40,
		ryFactor: 0.45
	};

	// Star sprite for coins
	const starSprite = {
		img: new Image(),
		loaded: false,
		url: 'assets/star.png'
	};
	starSprite.img.onload = () => { starSprite.loaded = true; };
	starSprite.img.onerror = () => { starSprite.loaded = false; };
	try { starSprite.img.src = starSprite.url; } catch {}
	sprite.img.onload = () => { sprite.loaded = true; };
	sprite.img.onerror = () => { sprite.loaded = false; };
	try { sprite.img.src = sprite.url; } catch {}

	// Mountains strip at bottom will be derived from background image (no separate asset)
	const mountains = { tile: null, loaded: false };

    // Game state
    let state = 'ready'; // 'ready' | 'running' | 'paused' | 'gameover'
    let score = 0;
    let highscore = Number(localStorage.getItem('flippi_highscore') || 0);

    const bird = {
        x: world.width * 0.28,
        y: world.height * 0.5,
        radius: 18,
        velocityY: 0,
        rotation: 0
    };

    /** @type {{x:number, top:number, bottom:number, passed:boolean}[]} */
    let pipes = [];
    /** @type {{x:number,y:number,r:number,collected:boolean,attachedTo:number,offsetX:number}[]} */
    let coins = [];
    let lastSpawnX = 0;
    let lastTime = 0;
    let coinSpin = 0; // rotation accumulator for coin horizontal spin
    // Star dust particles
    /** @type {{x:number,y:number,vx:number,vy:number,size:number,life:number,age:number,rot:number,spin:number}[]} */
    let particles = [];
    let starEmitAcc = 0;
    /** last used gap center to avoid straight rows */
    let lastGapCenter = null;
    // Difficulty scaling
    let speedLevel = 0; // increases every 30 points
    const SPEED_STEP_SCORE = 30;
    const PIPE_SPEED_INCREMENT = 12; // pixels/sec per level

    // UI elements
    const ui = {
        score: document.getElementById('score'),
        gameover: document.getElementById('gameover'),
        finalScore: document.getElementById('finalScore'),
        subtitle: document.getElementById('subtitle'),
        pauseBtn: document.getElementById('pauseBtn'),
        restartBtn: document.getElementById('restartBtn'),
        startScreen: document.getElementById('startScreen'),
        playBtn: document.getElementById('playBtn')
    };

    // Audio (WebAudio) – wird beim ersten User-Input initialisiert
    /** @type {AudioContext|null} */
    let audioCtx = null;
    /** @type {Record<string, AudioBuffer|undefined>} */
    const audioBuffers = {};
    /** @type {Record<string, HTMLAudioElement|undefined>} */
    const audioTags = {};
    /** @type {AudioBufferSourceNode|null} */
    let musicNode = null;
    /** @type {HTMLAudioElement|null} */
    let musicTag = null;
    /** @type {AudioBufferSourceNode|null} */
    let gameOverNode = null;
    /** @type {HTMLAudioElement|null} */
    let gameOverTag = null;
    const audioFiles = {
        flap: 'audio/wings_unicorn.mp3',
        score: 'audio/coin_sound.ogg',
        hit: 'audio/hit.ogg',
        music: 'audio/game_sound.ogg',
        gameover: 'audio/game_over.ogg'
    };
    async function ensureAudio() {
        if (!audioCtx) {
            try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
        }
        try { if (audioCtx && audioCtx.state === 'suspended') await audioCtx.resume(); } catch {}
        // lazy-load external audio files
        if (audioCtx) {
            for (const [name, url] of Object.entries(audioFiles)) {
                if (!url || audioBuffers[name] !== undefined) continue;
                fetch(url)
                    .then(r => r.ok ? r.arrayBuffer() : Promise.reject())
                    .then(ab => new Promise((res, rej) => audioCtx.decodeAudioData(ab, res, rej)))
                    .then(buf => { audioBuffers[name] = buf; })
                    .catch(() => { audioBuffers[name] = undefined; });
            }
        }
        // also prepare HTMLAudio fallbacks (works when opened via file://)
        for (const [name, url] of Object.entries(audioFiles)) {
            if (!url || audioTags[name]) continue;
            try {
                const el = new Audio(url);
                el.preload = 'auto';
                audioTags[name] = el;
            } catch {}
        }
    }
    function playBuffer(name, { gain = 0.12, rate = 1.0, loop = false } = {}) {
        if (!audioCtx) return null;
        const buf = audioBuffers[name];
        if (!buf) return null;
        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        src.loop = loop;
        src.playbackRate.value = rate;
        const g = audioCtx.createGain();
        g.gain.value = gain;
        src.connect(g).connect(audioCtx.destination);
        src.start();
        return src;
    }
    function playTag(name, { volume = 0.6, loop = false, rate = 1.0 } = {}) {
        const base = audioTags[name];
        if (!base) return false;
        try {
            const el = base.cloneNode(true);
            el.loop = loop;
            el.volume = volume;
            el.playbackRate = rate;
            el.play();
            return true;
        } catch { return false; }
    }
    function playTone(frequency, durationMs, type = 'sine', gain = 0.08) {
        if (!audioCtx) return;
        const t0 = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.type = type;
        osc.frequency.value = frequency;
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(gain, t0 + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + durationMs / 1000);
        osc.connect(g).connect(audioCtx.destination);
        osc.start(t0);
        osc.stop(t0 + durationMs / 1000 + 0.02);
    }
    const sfx = {
        flap: () => { if (playBuffer('flap', { gain: 0.18 }) || playTag('flap', { volume: 0.6 })) return; playTone(680, 80, 'square', 0.06); },
        score: () => { if (playBuffer('score', { gain: 0.22 }) || playTag('score', { volume: 0.7 })) return; playTone(920, 90, 'triangle', 0.06); },
        hit: () => { if (playBuffer('hit', { gain: 0.22 }) || playTag('hit', { volume: 0.7 })) return; playTone(180, 180, 'sawtooth', 0.08); }
    };
    function startMusic() {
        if (!audioCtx) return;
        // already playing? do nothing
        if (musicNode) return;
        if (musicTag && !musicTag.paused) return;
        const node = playBuffer('music', { gain: 0.03, loop: true });
        if (node) {
            musicNode = node;
        } else {
            const base = audioTags['music'];
            if (base) {
                try {
                    musicTag = base; // reuse base to avoid excessive clones
                    musicTag.loop = true;
                    musicTag.volume = 0.1;
                    musicTag.playbackRate = 1.0;
                    musicTag.currentTime = 0;
                    musicTag.play();
                } catch {}
            }
        }
    }
    function stopMusic() {
        if (musicNode) { try { musicNode.stop(); } catch {} musicNode = null; }
        if (musicTag) { try { musicTag.pause(); } catch {} musicTag = null; }
    }

    function stopGameOverSound() {
        if (gameOverNode) { try { gameOverNode.stop(); } catch {} gameOverNode = null; }
        if (gameOverTag) { try { gameOverTag.pause(); gameOverTag.currentTime = 0; } catch {} gameOverTag = null; }
        // As a safeguard, also pause base tag if it exists
        const base = audioTags['gameover'];
        if (base) { try { base.pause(); base.currentTime = 0; } catch {} }
    }

    function resetGame() {
        score = 0;
        ui.score.textContent = '0';
        bird.y = world.height * 0.5;
        bird.velocityY = 0;
        bird.rotation = 0;
        pipes = [];
        coins = [];
        lastSpawnX = 0;
        speedLevel = 0;
        world.pipeSpeed = world.basePipeSpeed;
    }

    function startGame() {
        resetGame();
        state = 'running';
        ui.gameover.classList.add('hidden');
        if (ui.subtitle) ui.subtitle.textContent = '';
        ui.pauseBtn.disabled = false;
        ui.pauseBtn.textContent = 'Pause';
        // UI Sichtbarkeit
        ui.startScreen.classList.add('hidden');
        ui.pauseBtn.style.display = '';
        ui.restartBtn.style.display = 'none';
        // stop gameover loop if active
        stopGameOverSound();
        startMusic(); // idempotent
    }

    function endGame() {
        state = 'gameover';
        highscore = Math.max(highscore, score);
        localStorage.setItem('flippi_highscore', String(highscore));
        ui.finalScore.innerHTML = `Score: ${score}<br>Best: ${highscore}`;
        ui.gameover.classList.remove('hidden');
        if (ui.subtitle) ui.subtitle.textContent = '';
        ui.pauseBtn.disabled = true;
        sfx.hit();
        // Buttons: Restart sichtbar
        ui.pauseBtn.style.display = 'none';
        ui.restartBtn.style.display = '';
        stopMusic();
        // GameOver Musik als Schleife starten
        stopGameOverSound();
        if (audioCtx) {
            const node = playBuffer('gameover', { gain: 0.12, loop: true });
            if (node) { gameOverNode = node; }
            else {
                const base = audioTags['gameover'];
                if (base) { gameOverTag = base; try { gameOverTag.loop = true; gameOverTag.volume = 0.1; gameOverTag.currentTime = 0; gameOverTag.play(); } catch {} }
            }
        }
    }

    function togglePause() {
        if (state === 'running') {
            state = 'paused';
            ui.pauseBtn.textContent = 'Weiter';
        } else if (state === 'paused') {
            state = 'running';
            ui.pauseBtn.textContent = 'Pause';
        }
    }

    function flap() {
        ensureAudio();
        if (state === 'ready') {
            startGame();
        }
        if (state !== 'running') return;
        bird.velocityY = world.jumpImpulse;
        sfx.flap();
        // burst of particles on flap
        emitStarBurst(7);
    }

    // Input
    window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' || e.code === 'ArrowUp') {
            e.preventDefault();
            if (state === 'gameover') {
                startGame();
                return;
            }
            flap();
        } else if (e.code === 'Enter') {
            if (state === 'gameover' || state === 'ready') startGame();
        } else if (e.code === 'KeyP') {
            togglePause();
        }
    });
    canvas.addEventListener('pointerdown', () => {
        ensureAudio();
        if (state === 'gameover') { startGame(); return; }
        if (state === 'paused') { togglePause(); return; }
        flap();
    });

    ui.pauseBtn.addEventListener('click', () => {
        ensureAudio();
        if (state === 'ready') { startGame(); return; }
        if (state === 'gameover') return;
        togglePause();
        // Buttons umschalten
        if (state === 'paused') {
            ui.pauseBtn.style.display = 'none';
            ui.restartBtn.style.display = '';
        } else if (state === 'running') {
            ui.pauseBtn.style.display = '';
            ui.restartBtn.style.display = 'none';
        }
    });
    ui.restartBtn.addEventListener('click', async () => {
        await ensureAudio();
        stopGameOverSound();
        startGame();
    });
    ui.playBtn.addEventListener('click', () => {
        ensureAudio();
        startGame();
    });

    // Helpers
    function randRange(min, max) { return Math.random() * (max - min) + min; }

    function spawnPipePair() {
        // Sichere vertikale Grenzen, damit Wolken nicht abgeschnitten werden
        const gapHalf = world.pipeGap / 2;
        const baseW = world.pipeWidth * cloudVisual.baseWScale;
        const baseH = cloudVisual.baseH;
        const overlap = cloudVisual.overlap;
        // UI-Sicherheitsabstand: unter dem Logo/Titel (ca. 12px top + 40px Höhe + Puffer)
        const uiSafeTop = 70;
        // Obergrenze für Top-Wolke: ihr Unterrand liegt bei p.top, gezeichnet wird sie
        // bei ty = p.top - (baseH - overlap). Damit sie nicht abgeschnitten wird:
        // ty >= 0 -> p.top >= (baseH - overlap)
        const minTop = Math.max(uiSafeTop, (baseH - overlap));
        // Untere Wolke: beginnt bei (p.bottom - overlap) und hat Höhe baseH.
        // Damit ihr Unterrand nicht unter den Boden ragt:
        // (p.bottom - overlap) + baseH <= world.height - world.groundHeight
        const maxBottom = (world.height - world.groundHeight) - (baseH - overlap);
        // Daraus erlaubte Lücken-Zentren ableiten
        const minCenter = minTop + gapHalf;
        const maxCenter = maxBottom - gapHalf;
        // Ziehe so lange neu, bis sich die Höhe merklich von der letzten unterscheidet
        let gapCenter = randRange(minCenter, Math.max(minCenter + 1, maxCenter));
        if (lastGapCenter !== null) {
            const minDelta = 70; // Mindestabweichung zwischen aufeinanderfolgenden Lücken
            let guard = 0;
            while (Math.abs(gapCenter - lastGapCenter) < minDelta && guard++ < 8) {
                gapCenter = randRange(minCenter, Math.max(minCenter + 1, maxCenter));
            }
        }
        lastGapCenter = gapCenter;
        const top = gapCenter - gapHalf;
        const bottom = gapCenter + gapHalf;
        const pipeIndex = pipes.push({ x: world.width + world.pipeWidth, top, bottom, passed: false }) - 1;
        // Mehr Sterne in der Lücke platzieren (z. B. drei in einer Reihe)
        const coinCount = 3;
        const spacing = 42; // Abstand der Sterne entlang der X-Achse
        const startOffset = world.pipeWidth * 0.5 - spacing; // zentriert um die Mitte
        for (let i = 0; i < coinCount; i++) {
            coins.push({
                x: 0, // wird im Update an Pipe gebunden
                y: gapCenter,
                r: 10,
                collected: false,
                attachedTo: pipeIndex,
                offsetX: startOffset + i * spacing
            });
        }
    }

    function update(dt) {
        if (state !== 'running') return;

        // Bird physics
        bird.velocityY += world.gravity * dt;
        bird.y += bird.velocityY * dt;
        const maxFall = 600;
        if (bird.velocityY > maxFall) bird.velocityY = maxFall;
        bird.rotation = Math.atan2(bird.velocityY, 400);

        // Spawn pipes based on spacing
        lastSpawnX += world.pipeSpeed * dt;
        if (lastSpawnX >= world.pipeSpacing) {
            spawnPipePair();
            lastSpawnX = 0;
        }

        // Move pipes
        for (let i = pipes.length - 1; i >= 0; i--) {
            const p = pipes[i];
            p.x -= world.pipeSpeed * dt;
            // Remove off-screen
            if (p.x + world.pipeWidth < -100) {
                pipes.splice(i, 1);
                // entferne Coins, die an diese Pipe gekoppelt waren
                for (let k = coins.length - 1; k >= 0; k--) {
                    if (coins[k].attachedTo === i) coins.splice(k, 1);
                }
                // verschiebe attachedTo-Referenzen nach Entfernen (Index-shift)
                for (const c of coins) {
                    if (c.attachedTo > i) c.attachedTo -= 1;
                }
                continue;
            }
            // Kein Score mehr beim Passieren der Pipes
            const passX = p.x + world.pipeWidth / 2;
            if (!p.passed && passX < bird.x) {
                p.passed = true;
            }
        }

        // Coins bewegen (mit Pipes) und Kollision prüfen
        coinSpin += 4 * dt; // spin speed
        for (let i = coins.length - 1; i >= 0; i--) {
            const c = coins[i];
            // Coin-Position folgt der zugehörigen Pipe (x), y bleibt in Lückenmitte
            const pipe = pipes[c.attachedTo];
            if (!pipe) { coins.splice(i, 1); continue; }
            c.x = pipe.x + c.offsetX;
            // Entfernen, wenn weit links raus
            if (c.x < -50) { coins.splice(i, 1); continue; }

            // Kollision Vogel-Coin (Kreis-Kreis)
            const dx = (bird.x) - c.x;
            const dy = (bird.y) - c.y;
            const rr = (bird.radius + c.r) * (bird.radius + c.r);
            if (dx*dx + dy*dy <= rr) {
                coins.splice(i, 1);
                score += 1; // Punkte nur über Sterne
                ui.score.textContent = String(score);
                sfx.score();
                // increase difficulty every 30 points
                const nextLevel = Math.floor(score / SPEED_STEP_SCORE);
                if (nextLevel > speedLevel) {
                    speedLevel = nextLevel;
                    world.pipeSpeed += PIPE_SPEED_INCREMENT;
                }
            }
        }

        // Emit and update star dust
        const baseRate = 12; // per second
        const boost = bird.velocityY < -40 ? 18 : 0; // more when going up
        starEmitAcc += (baseRate + boost) * dt;
        while (starEmitAcc >= 1) { createParticle(); starEmitAcc -= 1; }
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.age += dt;
            if (p.age >= p.life) { particles.splice(i, 1); continue; }
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vy += 20 * dt; // slight drift downwards
            p.rot += p.spin * dt;
        }

        // Collision with ground or ceiling
        if (bird.y - bird.radius < 0) {
            bird.y = bird.radius;
            bird.velocityY = 0;
        }
        if (bird.y + bird.radius > world.height - world.groundHeight) {
            bird.y = world.height - world.groundHeight - bird.radius;
            endGame();
            return;
        }

        // Collision with clouds (ellipse tests per cloud). Fallback: rect when sprite not loaded.
        for (const p of pipes) {
            const bx = bird.x;
            const by = bird.y;
            const r = bird.radius;
            const withinX = (bx + r > p.x) && (bx - r < p.x + world.pipeWidth);
            if (!withinX) continue;

            if (cloudSprite.loaded) {
                const baseW = world.pipeWidth * cloudVisual.baseWScale;
                const baseH = cloudVisual.baseH;
                const cxBottom = p.x - (baseW - world.pipeWidth) / 2 + baseW / 2;
                const cyBottom = p.bottom - cloudVisual.overlap + baseH * 0.52; // unten bleibt gleich
                const cxTop = cxBottom;
                // Top cloud ist nun aufrecht oberhalb der Lücke: y-Position angepasst
                const cyTop = Math.max(0, p.top) - (baseH - cloudVisual.overlap) + baseH * 0.48;
                const rx = baseW * cloudVisual.rxFactor;
                const ry = baseH * cloudVisual.ryFactor;

                // circle-ellipse overlap: scale space by ellipse radii and test circle vs circle
                function collidesEllipse(cx, cy) {
                    const dx = (bx - cx) / rx;
                    const dy = (by - cy) / ry;
                    const scaledR = r / Math.max(rx, ry);
                    return (dx*dx + dy*dy) <= (1 + scaledR) * (1 + scaledR);
                }

                if (by < p.top) {
                    if (collidesEllipse(cxTop, cyTop)) { endGame(); return; }
                } else if (by > p.bottom) {
                    if (collidesEllipse(cxBottom, cyBottom)) { endGame(); return; }
                } else {
                    // Inside the gap, but the bird radius could still touch the clouds' inner lips
                    if (collidesEllipse(cxTop, cyTop) || collidesEllipse(cxBottom, cyBottom)) { endGame(); return; }
                }
            } else {
                // fallback to original rectangle check
                if (by - r < p.top || by + r > p.bottom) { endGame(); return; }
            }
        }
    }

    function drawBackground(dt) {
        // Parallax: nahtloser Himmel + nahtloser Bergstreifen, beide aus background.png
        ctx.save();
        if (!drawBackground.bg) {
            const img = new Image();
            img.onload = () => {
                drawBackground.bgLoaded = true;
                drawBackground.bg = img;
                // Sky tile: gespiegelte Doppelkachel der gesamten Grafik
                const sky = document.createElement('canvas');
                sky.width = img.width * 2; sky.height = img.height;
                const sctx = sky.getContext('2d');
                sctx.drawImage(img, 0, 0);
                sctx.save(); sctx.translate(sky.width, 0); sctx.scale(-1, 1); sctx.drawImage(img, 0, 0); sctx.restore();
                drawBackground.skyTile = sky;
                // Mountain tile: unterer Anteil (ca. 28% Höhe) als eigener Streifen
                const stripH = Math.floor(img.height * 0.28);
                const srcY = img.height - stripH;
                const mount = document.createElement('canvas');
                mount.width = img.width * 2; mount.height = stripH;
                const mctx = mount.getContext('2d');
                mctx.drawImage(img, 0, srcY, img.width, stripH, 0, 0, img.width, stripH);
                mctx.save(); mctx.translate(mount.width, 0); mctx.scale(-1, 1); mctx.drawImage(img, 0, srcY, img.width, stripH, 0, 0, img.width, stripH); mctx.restore();
                drawBackground.mountTile = mount;
            };
            img.onerror = () => { drawBackground.bgLoaded = false; };
            img.src = 'assets/background.png';
            drawBackground.bg = img;
        }

        const skyTile = drawBackground.skyTile;
        const mountTile = drawBackground.mountTile;
        const heightSky = world.height - world.groundHeight;

        // Geschwindigkeiten
        const speedSky = world.pipeSpeed * 0.25;
        const speedMount = world.pipeSpeed * 0.65;
        if (state === 'running') {
            drawBackground.offSky = (drawBackground.offSky || 0) - speedSky * dt;
            drawBackground.offMount = (drawBackground.offMount || 0) - speedMount * dt;
        }

        // Sky zeichnen (nahtlos, auf Höhe heightSky skaliert)
        if (skyTile && drawBackground.bgLoaded) {
            const ratio = skyTile.width / skyTile.height;
            const drawH = heightSky;
            const drawW = drawH * ratio;
            let x = (drawBackground.offSky || 0) % drawW; if (x > 0) x -= drawW;
            for (; x < world.width; x += drawW) {
                ctx.drawImage(skyTile, x, 0, drawW, drawH);
            }
        } else {
            // Fallback: Verlauf
            const grd = ctx.createLinearGradient(0, 0, 0, heightSky);
            grd.addColorStop(0, '#78d1ff'); grd.addColorStop(1, '#b9ecff');
            ctx.fillStyle = grd; ctx.fillRect(0, 0, world.width, heightSky);
        }

        // Keine untere Ebene rendern – Kollision bleibt über world.groundHeight bestehen
        ctx.restore();
    }

    function drawPipes() {
        // Draw clouds instead of green pipes. Beide Wolken werden AUFRECHT gezeichnet.
        ctx.save();
        const baseW = world.pipeWidth * cloudVisual.baseWScale; // etwas breiter als Öffnung
        const baseH = cloudVisual.baseH; // Cloud-Höhe
        for (const p of pipes) {
            if (cloudSprite.loaded) {
                // Bottom cloud sitzt knapp oberhalb des Bodens der Lücke
                const bx = p.x - (baseW - world.pipeWidth) / 2;
                const by = p.bottom - cloudVisual.overlap; // kleine Überlappung in die Lücke
                ctx.drawImage(cloudSprite.img, bx, by, baseW, baseH);

                // Top cloud AUFRECHT, sitzt knapp unterhalb des Dachs der Lücke
                const tx = p.x - (baseW - world.pipeWidth) / 2;
                const ty = Math.max(0, p.top) - (baseH - cloudVisual.overlap);
                ctx.drawImage(cloudSprite.img, tx, ty, baseW, baseH);
            } else {
                // Fallback: grüne Rechtecke wie vorher
                ctx.fillStyle = '#2ecc71';
                ctx.fillRect(p.x, 0, world.pipeWidth, Math.max(0, p.top));
                ctx.fillRect(p.x, p.bottom, world.pipeWidth, world.height - world.groundHeight - p.bottom);
            }
        }
        ctx.restore();
    }

    function drawCoins() {
        ctx.save();
        for (let idx = 0; idx < coins.length; idx++) {
            const c = coins[idx];
            if (starSprite.loaded) {
                const w = c.r * 5;
                const h = c.r * 5;
                ctx.save();
                ctx.translate(c.x, c.y);
                // simulate horizontal 3D spin by scaling X with cos(angle)
                const phase = coinSpin * 2 + idx * 0.6;
                const scaleX = Math.cos(phase);
                const absScale = Math.max(0.2, Math.abs(scaleX));
                ctx.scale(scaleX >= 0 ? absScale : -absScale, 1);
                ctx.drawImage(starSprite.img, -w / 2, -h / 2, w, h);
                ctx.restore();
            } else {
                // fallback: simple golden circle
                const grd = ctx.createRadialGradient(c.x - 2, c.y - 2, 1, c.x, c.y, c.r);
                grd.addColorStop(0, '#fff6a3');
                grd.addColorStop(1, '#f2c200');
                ctx.fillStyle = grd;
                ctx.beginPath();
                ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = 'rgba(0,0,0,0.15)';
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        }
        ctx.restore();
    }

    function drawBird() {
		ctx.save();
		ctx.translate(bird.x, bird.y);
		ctx.rotate(bird.rotation);
		if (sprite.loaded) {
			// draw centered sprite
			ctx.imageSmoothingEnabled = true;
			ctx.drawImage(
				sprite.img,
				Math.round(-sprite.drawW / 2),
				Math.round(-sprite.drawH / 2),
				sprite.drawW,
				sprite.drawH
			);
		} else {
			// fallback: simple circle bird
			ctx.fillStyle = '#ffd166';
			ctx.beginPath();
			ctx.arc(0, 0, bird.radius, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = '#000';
			ctx.beginPath();
			ctx.arc(6, -4, 3, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = '#f77f00';
			ctx.beginPath();
			ctx.moveTo(bird.radius - 4, 0);
			ctx.lineTo(bird.radius + 10, -4);
			ctx.lineTo(bird.radius + 10, 4);
			ctx.closePath();
			ctx.fill();
		}
		ctx.restore();
    }

    function draw(dt) {
        ctx.clearRect(0, 0, world.width, world.height);
        drawBackground(dt);
        drawPipes();
        drawCoins();
        drawParticles();
        drawBird();
    }

    function createParticle() {
        const speed = 60 + Math.random() * 80;
        const dirX = -1;
        const spreadY = (Math.random() - 0.5) * 60;
        particles.push({
            x: bird.x - 18,
            y: bird.y + spreadY * 0.08,
            vx: dirX * speed,
            vy: spreadY * 0.2,
            size: 8 + Math.random() * 6,
            life: 0.7 + Math.random() * 0.4,
            age: 0,
            rot: Math.random() * Math.PI * 2,
            spin: (Math.random() - 0.5) * 4
        });
    }

    function emitStarBurst(n) { for (let i = 0; i < n; i++) createParticle(); }

    function drawParticles() {
        ctx.save();
        for (const p of particles) {
            const t = p.age / p.life;
            const alpha = Math.max(0, 1 - t);
            ctx.globalAlpha = alpha * 0.9;
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            const s = p.size * (0.8 + 0.4 * (1 - t));
            if (starSprite.loaded) {
                ctx.drawImage(starSprite.img, -s / 2, -s / 2, s, s);
            } else {
                ctx.fillStyle = 'rgba(255, 210, 80, 0.9)';
                ctx.beginPath();
                ctx.arc(0, 0, s * 0.4, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // reset to base transform considering HiDPI
            ctx.globalAlpha = 1;
        }
        ctx.restore();
    }

    function frame(ts) {
        if (!lastTime) lastTime = ts;
        const dt = Math.min(1 / 30, (ts - lastTime) / 1000);
        lastTime = ts;
        update(dt);
        draw(dt);
        requestAnimationFrame(frame);
    }

    // Initial prompt visible, game in 'ready'
    resetGame();
    requestAnimationFrame(frame);
})();


