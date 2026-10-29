// no toLocale*/Intl, crashes panorama

var DLM_BUILD = 'dlmusic_main_v1_2';
$.Msg('[DLMusic] BUILD ' + DLM_BUILD + ' loaded.\n');

(function () {
    'use strict';

    var YT_HOME = 'https://www.youtube.com/';
    var YT_LIGHT = 'https://www.youtube.com/robots.txt';
    var RELAY_URL = 'wss://relay-ckjvp.dlr-k7q2m9x.workers.dev/r/anrKvZKLlQaJZu1ScaK9kM9z/';
    var API_URL = 'https://relay-ckjvp.dlr-k7q2m9x.workers.dev/';
    var API_KEY = 'anrKvZKLlQaJZu1ScaK9kM9z';
    var DLM_VERSION = '1.2';
    var DEV_BUILD = false;
    var MOD_PAGE = 'https://gamebanana.com/mods/720163';
    var STEAM_VDF = 'C:/Program Files (x86)/Steam/steamapps/libraryfolders.vdf';
    var FOLDER_TAIL = '/steamapps/common/Deadlock/game/citadel/addons/deadlockradio_music';
    var STEAM_GUESSES = ['C:/Program Files (x86)/Steam', 'C:/Program Files/Steam', 'C:/SteamLibrary', 'D:/SteamLibrary',
        'E:/SteamLibrary', 'F:/SteamLibrary', 'G:/SteamLibrary', 'D:/Steam', 'E:/Steam', 'F:/Steam', 'D:/Games/Steam',
        'D:/Games/SteamLibrary', 'E:/Games/SteamLibrary', 'D:/Program Files (x86)/Steam'];

    var ICON_DIR = 's2r://panorama/images/custom/dlmusic/';
    var ICON_PLAY = ICON_DIR + 'dlm_play.vsvg';
    var ICON_PAUSE = ICON_DIR + 'dlm_pause.vsvg';
    var ICON_NEXT = ICON_DIR + 'dlm_forward.vsvg';
    var ICON_PREV = ICON_DIR + 'dlm_backward.vsvg';
    var ICON_EMPTY = ICON_DIR + 'dlm_note.vsvg';
    var ICON_QUIET = ICON_DIR + 'dlm_quiet.vsvg';
    var ICON_SHUFFLE = ICON_DIR + 'dlm_shuffle.vsvg';

    var BROWSER_W = 680;
    var BROWSER_H = 558;
    var BROWSER_DX = 243;
    var BROWSER_DY = 66;

    var root = null;
    var panel = null;
    var cefPanel = null;
    var browserFrame = null;

    var lastCombatMs = 0;
    var currentDuration = 0;
    var isPlaying = false;

    var currentSource = 'youtube';
    var pageSeen = false;
    var bridgeOk = false;
    var lastBridgeMsgMs = 0;
    var injectCount = 0;
    var lastQuickInject = 0;
    var seenQ = {}, seenCount = 0;
    var BRIDGE_TIMEOUT_MS = 6000;

    var browserVisible = false;

    var DLMusic = (globalThis.DLMusic = globalThis.DLMusic || {});
    DLMusic.logBuffer = DLMusic.logBuffer || [];
    DLMusic.dev = DEV_BUILD;
    function DevLog(msg) { if (DEV_BUILD) DLMusic.log(msg); }
    DLMusic.log = function (msg) {
        var d = new Date();
        function pad(n) { return (n < 10 ? '0' : '') + n; }
        var stamp = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
        var line = '[' + stamp + '] ' + msg;
        DLMusic.logBuffer.push(line);
        if (DLMusic.logBuffer.length > 250) DLMusic.logBuffer.shift();
        try { $.Msg('[DLMusic] ' + msg + '\n'); } catch (e) { }
    };

    var S = (DLMusic.settings = DLMusic.settings || {
        source: 'youtube',
        folderPath: '',
        normalVol: 30,
        quietVol: 10,
        duckEnabled: true,
        combatVol: 10,
        fadeOutSec: 0.5,
        fadeInSec: 2.0,
        holdSec: 3.0,
        tabMode: 'mute',
        skipAds: true,
        artBorder: true,
        borderStyle: 'gold',
        gloss: 40,
        sheen: true,
        sheenSec: 1.2,
        sheenDelayMin: 4.0,
        sheenDelayMax: 9.0,
        visualizer: true,
        vizPos: 'left',
        vizSens: 100,
        vizSmooth: 50,
        shareSongs: false,
        showHud: true,
        showArt: true,
        playerStyle: 'full',
        rememberSong: false,
        shuffle: true,
        browserZoom: 0,
        fbAt: 0,
        lastTab: 'playback'
    });
    var DEFAULTS = JSON.parse(JSON.stringify(S));
    DLMusic.quiet = false;
    var settingsTs = 0;

    function ApplySavedSettings(saved) {
        if (!saved) return;
        var ts = saved._ts || 1;
        if (ts <= settingsTs) return;
        settingsTs = ts;
        if (saved.tabMode === undefined && saved.playWhenTabbedOut === true) saved.tabMode = 'play';
        var n = 0;
        for (var k in S) {
            if (saved.hasOwnProperty(k) && typeof saved[k] === typeof S[k]) { S[k] = saved[k]; n++; }
        }
        if (S.source !== 'youtube' && S.source !== 'folder') S.source = 'youtube';
        DLMusic.log('Loaded ' + n + ' saved settings.');
        ApplyLook();
        if (S.source !== currentSource) SwitchSource(S.source);
    }

    function SettingsJson() {
        var o = {};
        for (var k in S) o[k] = S[k];
        o._ts = settingsTs;
        return JSON.stringify(o);
    }

    var saveQueued = false;
    DLMusic.settingsChanged = function () {
        settingsTs = Date.now();
        ApplyLook();
        SendZoom();
        if (S.source !== currentSource) SwitchSource(S.source);
        else if (currentSource === 'folder' && S.folderPath !== loadedFolder) LoadSource('folder');
        if (saveQueued) return;
        saveQueued = true;
        $.Schedule(0.6, function () {
            saveQueued = false;
            ExecCEF('window.lkSaveSettings(' + SettingsJson() + ')');
        });
    };

    DLMusic.resetSettings = function () {
        var fb = S.fbAt;
        for (var k in DEFAULTS) S[k] = DEFAULTS[k];
        S.fbAt = fb;
        DLMusic.quiet = false;
        DLMusic.log('Settings reset to defaults.');
        DLMusic.settingsChanged();
    };

    function Valid(p) { return p && p.IsValid && p.IsValid(); }

    function FindRoot() {
        if (Valid(root)) return root;
        var ctx = null;
        try { ctx = $.GetContextPanel(); } catch (e) { ctx = null; }
        if (!ctx) return null;
        var p = ctx;
        while (p.GetParent && p.GetParent()) p = p.GetParent();
        root = p;
        return root;
    }

    function HudLayer() {
        var ctx = null;
        try { ctx = $.GetContextPanel(); } catch (e) { ctx = null; }
        if (!ctx) return null;
        var layer = ctx.FindChildTraverse('DLMHudLayer');
        if (!layer) {
            layer = $.CreatePanel('Panel', ctx, 'DLMHudLayer');
            layer.AddClass('DLMHudLayer');
            layer.hittest = false;
            layer.hittestchildren = true;
        }
        return layer;
    }

    function FastButton(p, fn) {
        p.SetPanelEvent('onactivate', fn);
    }
    DLMusic.fastButton = FastButton;

    var arts = [];
    var artState = { url: '', square: false };
    var artFailLogged = false;
    var BORDER_STYLES = ['gold', 'silver', 'dark', 'neon', 'glass'];

    function BuildArt(parent, id, inner, clickable) {
        var border = $.CreatePanel('Panel', parent, id);
        border.AddClass('DLMArtBorder');
        border.style.width = (inner + 6) + 'px';
        border.style.height = (inner + 6) + 'px';
        border.hittest = !!clickable;
        if (clickable) FastButton(border, function () { ToggleQuiet(); });

        var frame = $.CreatePanel('Panel', border, id + 'Frame');
        frame.AddClass('DLMArtFrame');
        frame.hittest = false;

        var empty = $.CreatePanel('Image', frame, id + 'Empty');
        empty.AddClass('DLMArtEmpty');
        empty.SetImage(ICON_EMPTY);
        empty.style.width = Math.round(inner * 0.44) + 'px';
        empty.style.height = Math.round(inner * 0.44) + 'px';
        empty.hittest = false;

        var img = $.CreatePanel('Image', frame, id + 'Img');
        img.AddClass('DLMArtImg');
        img.hittest = false;
        img.style.opacity = '0';
        try {
            $.RegisterEventHandler('ImageFailedLoad', img, function () {
                if (!artState.url || artState.url.indexOf('data:') !== 0) return;
                if (!artFailLogged) { artFailLogged = true; DLMusic.log("Folder: the HUD can't show album art from the file."); }
                artState.url = '';
                for (var i = 0; i < arts.length; i++) ApplyArtImage(arts[i]);
            });
        } catch (e) { }

        var gloss = $.CreatePanel('Panel', frame, id + 'Gloss');
        gloss.AddClass('DLMGloss');
        gloss.hittest = false;
        var spec = $.CreatePanel('Panel', gloss, '');
        spec.AddClass('DLMGlossSpec');
        spec.hittest = false;
        var shade = $.CreatePanel('Panel', gloss, '');
        shade.AddClass('DLMGlossShade');
        shade.hittest = false;
        var edge = $.CreatePanel('Panel', gloss, '');
        edge.AddClass('DLMGlossEdge');
        edge.hittest = false;

        var sheen = $.CreatePanel('Panel', frame, id + 'Sheen');
        sheen.AddClass('DLMSheen');
        var sL = $.CreatePanel('Panel', sheen, '');
        sL.AddClass('DLMSheenL');
        sL.hittest = false;
        var sR = $.CreatePanel('Panel', sheen, '');
        sR.AddClass('DLMSheenR');
        sR.hittest = false;
        sheen.style.width = Math.round(inner * 0.6) + 'px';
        sheen.style.height = Math.round(inner * 2.4) + 'px';
        sheen.style.marginTop = (-Math.round(inner * 0.7)) + 'px';
        sheen.style.opacity = '0';
        sheen.hittest = false;

        var quiet = $.CreatePanel('Image', frame, id + 'Quiet');
        quiet.AddClass('DLMQuietIcon');
        quiet.SetImage(ICON_QUIET);
        quiet.style.width = Math.round(inner * 0.44) + 'px';
        quiet.style.height = Math.round(inner * 0.44) + 'px';
        quiet.hittest = false;

        var inst = { border: border, frame: frame, img: img, empty: empty, gloss: gloss, sheen: sheen, inner: inner };
        arts.push(inst);
        ApplyArtImage(inst);
        ApplyLookTo(inst);
        return inst;
    }

    function ApplyArtImage(inst) {
        if (!Valid(inst.img)) return;
        if (artState.url) {
            inst.img.SetImage(artState.url);
            var w = artState.square ? inst.inner : Math.round(inst.inner * 16 / 9);
            inst.img.style.width = w + 'px';
            inst.img.style.height = inst.inner + 'px';
            inst.img.style.marginLeft = (-Math.round((w - inst.inner) / 2)) + 'px';
            inst.img.style.opacity = '1';
            inst.empty.style.opacity = '0';
        } else {
            inst.img.style.opacity = '0';
            inst.empty.style.opacity = '1';
        }
    }

    function SetArt(url, square) {
        artState.url = url || '';
        artState.square = !!square;
        for (var i = 0; i < arts.length; i++) ApplyArtImage(arts[i]);
    }

    function ApplyLookTo(inst) {
        if (!Valid(inst.border)) return;
        inst.border.SetHasClass('DLMBorderOff', !S.artBorder);
        for (var i = 0; i < BORDER_STYLES.length; i++) {
            inst.border.SetHasClass('DLMBorder_' + BORDER_STYLES[i], S.borderStyle === BORDER_STYLES[i]);
        }
        inst.gloss.style.opacity = String(Math.max(0, Math.min(1, S.gloss / 100)));
        inst.frame.SetHasClass('DLMQuietOn', !!DLMusic.quiet);
    }

    function ApplyLook() {
        var keep = [];
        for (var i = 0; i < arts.length; i++) {
            if (Valid(arts[i].border)) { ApplyLookTo(arts[i]); keep.push(arts[i]); }
        }
        arts = keep;
        if (builtStyle && builtStyle !== S.playerStyle) { RebuildPlayers(); return; }
        ApplyPlayerLooks();
    }

    var sheenNext = Date.now() + 1500;
    var sheenOn = false;

    function RandDelay() {
        var lo = Math.max(0, Math.min(S.sheenDelayMin, S.sheenDelayMax));
        var hi = Math.max(S.sheenDelayMin, S.sheenDelayMax);
        return (lo + Math.random() * (hi - lo)) * 1000;
    }

    function HideSheens() {
        if (!sheenOn) return;
        sheenOn = false;
        for (var i = 0; i < arts.length; i++) if (Valid(arts[i].sheen)) arts[i].sheen.style.opacity = '0';
    }

    function SheenTick() {
        var now = Date.now();
        if (!S.sheen || !artState.url) {
            HideSheens();
            sheenNext = now + 1000;
            $.Schedule(0.2, SheenTick);
            return;
        }
        var sweepMs = Math.max(0.3, S.sheenSec) * 1000;
        if (now < sheenNext) {
            HideSheens();
        } else {
            var t = (now - sheenNext) / sweepMs;
            if (t >= 1) {
                HideSheens();
                sheenNext = now + RandDelay();
            } else {
                var e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
                sheenOn = true;
                for (var i = 0; i < arts.length; i++) {
                    var a = arts[i];
                    if (!Valid(a.sheen)) continue;
                    var from = -a.inner * 1.0, to = a.inner * 1.4;
                    var x = from + (to - from) * e;
                    a.sheen.style.transform = 'translate3d(' + Math.round(x) + 'px, 0px, 0px) rotateZ(22deg)';
                    a.sheen.style.opacity = '1';
                }
            }
        }
        $.Schedule(0.02, SheenTick);
    }

    var players = [];
    var np = { title: '', artist: '', pct: 0 };
    var lastToggleAt = 0;

    var MARQ_TICK = 0.04;
    var MARQ_SPEED = 30;
    var MARQ_START_PAUSE = 2500;
    var MARQ_END_PAUSE = 1500;

    function CreateIconButton(parent, id, cls, icon, onClick) {
        var btn = $.CreatePanel('Button', parent, id);
        btn.AddClass('DLMIconBtn');
        btn.AddClass(cls);
        var img = $.CreatePanel('Image', btn, id + 'Icon');
        img.AddClass('DLMIcon');
        img.SetImage(icon);
        img.hittest = false;
        FastButton(btn, onClick);
        return img;
    }

    function BuildPlayer(parent, id, cls) {
        var mini = S.playerStyle === 'minimal';
        var box = $.CreatePanel('Panel', parent, id);
        box.AddClass('DLMPlayer');
        box.AddClass(cls);
        box.SetHasClass('DLMMini', mini);
        box.hittest = false;
        box.hittestchildren = true;

        var top = box;
        if (mini) {
            top = $.CreatePanel('Panel', box, id + 'Top');
            top.AddClass('DLMMiniTop');
            top.hittest = false;
            top.hittestchildren = true;
        }
        var artCell = $.CreatePanel('Panel', top, id + 'ArtCell');
        artCell.AddClass('DLMArtCell');
        artCell.hittest = false;
        artCell.hittestchildren = true;
        var art = BuildArt(artCell, id + 'Art', mini ? 38 : 90, true);
        ApplyLookTo(art);

        var pl = { box: box, artCell: artCell, vizBars: [], vizShown: null, marqOffset: 0, marqAtEnd: false, marqPauseUntil: Date.now() + MARQ_START_PAUSE, look: '', barW: mini ? 210 : 186, mini: mini };

        var right = $.CreatePanel('Panel', top, id + 'Right');
        right.AddClass('DLMusicHUDRight');
        right.hittest = false;
        right.hittestchildren = true;

        pl.titleRow = $.CreatePanel('Button', right, id + 'TitleRow');
        pl.titleRow.AddClass('DLMusicTitleRow');
        pl.titleRow.hittest = false;
        FastButton(pl.titleRow, function () { if (!S.showArt || mini) ToggleQuiet(); });
        pl.titleQuiet = $.CreatePanel('Image', pl.titleRow, id + 'TitleQuiet');
        pl.titleQuiet.AddClass('DLMTitleQuiet');
        pl.titleQuiet.SetImage(ICON_QUIET);
        pl.titleQuiet.hittest = false;
        pl.titleClip = $.CreatePanel('Panel', pl.titleRow, id + 'TitleClip');
        pl.titleClip.AddClass('DLMusicTitleClip');
        pl.titleClip.hittest = false;
        var titleStrip = $.CreatePanel('Panel', pl.titleClip, id + 'TitleStrip');
        titleStrip.AddClass('DLMusicTitleStrip');
        titleStrip.hittest = false;
        pl.titleLabel = $.CreatePanel('Label', titleStrip, id + 'Title');
        pl.titleLabel.AddClass('DLMusicTitle');
        pl.titleLabel.text = np.title;

        var artistRow = $.CreatePanel(mini ? 'Button' : 'Panel', right, id + 'ArtistRow');
        artistRow.AddClass('DLMusicArtistRow');
        artistRow.hittest = mini;
        if (mini) FastButton(artistRow, function () { ToggleQuiet(); });
        pl.artistLabel = $.CreatePanel('Label', artistRow, id + 'Artist');
        pl.artistLabel.AddClass('DLMusicArtist');
        pl.artistLabel.text = np.artist;
        pl.vizSlot = $.CreatePanel('Panel', artistRow, id + 'Viz');
        pl.vizSlot.AddClass('DLMViz');
        pl.vizSlot.hittest = false;
        for (var i = 0; i < 5; i++) {
            var b = $.CreatePanel('Panel', pl.vizSlot, '');
            b.AddClass('DLMVizBar');
            b.hittest = false;
            pl.vizBars.push(b);
        }

        var lower = mini ? box : right;
        var wrap = $.CreatePanel('Panel', lower, id + 'ProgressWrap');
        wrap.AddClass('DLMProgressWrap');
        var track = $.CreatePanel('Panel', wrap, id + 'ProgressTrack');
        track.AddClass('DLMusicProgressTrack');
        track.hittest = false;
        pl.progressFill = $.CreatePanel('Panel', track, id + 'ProgressFill');
        pl.progressFill.AddClass('DLMusicProgressFill');
        pl.progressFill.hittest = false;
        pl.knob = $.CreatePanel('Panel', wrap, id + 'ProgressKnob');
        pl.knob.AddClass('DLMProgressKnob');
        pl.knob.hittest = false;
        pl.isHud = cls === 'DLMusicHUD';
        pl.progress = MakeProgress(wrap, id + 'Progress', pl);
        DrawBar(pl, np.pct);

        var controls = $.CreatePanel('Panel', lower, id + 'Controls');
        controls.AddClass('DLMusicHUDControls');
        controls.hittest = false;
        controls.hittestchildren = true;

        pl.shuffleIcon = CreateIconButton(controls, id + 'Shuffle', 'DLMShuffleBtn', ICON_SHUFFLE, function () { ToggleShuffle(); });
        pl.shuffleBtn = pl.shuffleIcon.GetParent();
        CreateIconButton(controls, id + 'Prev', 'DLMSkipBtn', ICON_PREV, function () { ExecCEF('window.lkPrev()'); });
        pl.playIcon = CreateIconButton(controls, id + 'PlayPause', 'DLMPlayBtn', isPlaying ? ICON_PAUSE : ICON_PLAY, function () { TogglePlayPause(); });
        CreateIconButton(controls, id + 'Next', 'DLMSkipBtn', ICON_NEXT, function () { ExecCEF('window.lkNext()'); });

        players.push(pl);
        ApplyPlayerLook(pl);
        return pl;
    }

    function ApplyPlayerLook(pl) {
        var folder = currentSource === 'folder';
        var quietTitle = !S.showArt && !!DLMusic.quiet;
        var look = [S.showArt, quietTitle, folder, !!S.shuffle].join('|');
        if (pl.look === look) return;
        pl.look = look;
        if (Valid(pl.artCell)) pl.artCell.style.visibility = S.showArt ? 'visible' : 'collapse';
        pl.box.SetHasClass('DLMNoArt', !S.showArt);
        pl.titleRow.hittest = !S.showArt || pl.mini;
        pl.titleRow.SetHasClass('DLMTitleQuietOn', quietTitle);
        if (Valid(pl.shuffleBtn)) {
            pl.shuffleBtn.style.visibility = folder ? 'visible' : 'collapse';
            pl.shuffleBtn.SetHasClass('DLMShuffleOn', !!S.shuffle);
        }
        pl.marqOffset = 0;
        pl.marqAtEnd = false;
        pl.marqPauseUntil = Date.now() + MARQ_START_PAUSE;
        if (Valid(pl.titleLabel)) pl.titleLabel.style.marginLeft = '0px';
    }

    function ApplyPlayerLooks() {
        var ps = LivePlayers();
        for (var i = 0; i < ps.length; i++) ApplyPlayerLook(ps[i]);
    }

    function ToggleShuffle() {
        S.shuffle = !S.shuffle;
        DLMusic.log('Shuffle ' + (S.shuffle ? 'on' : 'off') + '.');
        if (DLMusic.settingsChanged) DLMusic.settingsChanged();
    }

    function LivePlayers() {
        var keep = [];
        for (var i = 0; i < players.length; i++) if (Valid(players[i].box) && !players[i].dead) keep.push(players[i]);
        players = keep;
        return players;
    }

    function EnsurePanel() {
        if (Valid(panel)) return panel;

        var parent = HudLayer();
        if (!parent) return null;

        var existing = parent.FindChildTraverse ? parent.FindChildTraverse('DLMusicHUD') : null;
        if (existing) existing.DeleteAsync(0);

        panel = BuildPlayer(parent, 'DLMusicHUD', 'DLMusicHUD').box;
        if (!builtStyle) builtStyle = S.playerStyle;
        return panel;
    }
    var previewParent = null, builtStyle = '';
    DLMusic.buildPreviewPlayer = function (parent) { previewParent = parent; return BuildPlayer(parent, 'DLMusicPreview', 'DLMPreviewPlayer'); };

    function RebuildPlayers() {
        builtStyle = S.playerStyle;
        if (Valid(panel)) { panel.DeleteAsync(0); panel = null; }
        var ps = LivePlayers();
        for (var i = 0; i < ps.length; i++) { ps[i].dead = true; if (Valid(ps[i].box)) ps[i].box.DeleteAsync(0); }
        players = [];
        hudHidden = null;
        EnsurePanel();
        if (Valid(previewParent)) BuildPlayer(previewParent, 'DLMusicPreview', 'DLMPreviewPlayer');
        DLMusic.log('Player style: ' + S.playerStyle + '.');
    }

    function SetPlaying(on) {
        isPlaying = on;
        var ps = LivePlayers();
        for (var i = 0; i < ps.length; i++) if (Valid(ps[i].playIcon)) ps[i].playIcon.SetImage(on ? ICON_PAUSE : ICON_PLAY);
    }

    function SyncPlaying(on) {
        if (on === isPlaying || Date.now() - lastToggleAt < 1500) return;
        SetPlaying(on);
    }

    function TogglePlayPause() {
        lastToggleAt = Date.now();
        if (isPlaying) ExecCEF('window.lkPause()');
        else ExecCEF('window.lkPlay()');
        SetPlaying(!isPlaying);
    }

    function SetTitle(text) {
        np.title = text;
        var ps = LivePlayers();
        for (var i = 0; i < ps.length; i++) {
            var p = ps[i];
            if (!Valid(p.titleLabel)) continue;
            p.titleLabel.text = text;
            p.marqOffset = 0;
            p.marqAtEnd = false;
            p.marqPauseUntil = Date.now() + MARQ_START_PAUSE;
            p.titleLabel.style.marginLeft = '0px';
        }
    }

    function SetArtist(text) {
        np.artist = text || '';
        var ps = LivePlayers();
        for (var i = 0; i < ps.length; i++) if (Valid(ps[i].artistLabel)) ps[i].artistLabel.text = np.artist;
    }

    function CleanArtist(a) {
        a = String(a || '');
        if (currentSource !== 'youtube') return a;
        return a.replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/, '').trim();
    }

    function MakeProgress(parent, id, pl) {
        var sl = null;
        try { sl = $.CreatePanel('Slider', parent, id, { direction: 'horizontal' }); } catch (e) { sl = null; }
        if (!sl) { try { sl = $.CreatePanel('Slider', parent, id); } catch (e2) { sl = null; } }
        if (!sl) return null;
        sl.AddClass('HorizontalSlider');
        sl.AddClass('DLMProgress');
        try { sl.direction = 'horizontal'; } catch (e3) { }
        try { sl.min = 0; sl.max = 1000; sl.value = np.pct * 10; } catch (e4) { }
        pl.dragAt = 0;
        pl.pushing = false;
        pl.seekSentAt = 0;
        sl.SetPanelEvent('onvaluechanged', function () {
            if (pl.pushing) return;
            if (pl.isHud && !DLMusic.tabHeldNow && !(DLMusic.isMenuOpen && DLMusic.isMenuOpen())) return;
            var v = Number(sl.value);
            if (isNaN(v) || (!pl.dragging && Math.abs(v - np.pct * 10) < 2)) return;
            DragTo(v / 1000, pl);
        });
        return sl;
    }

    var seekFrac = 0, seekTarget = -1, seekAt = 0;
    function DragTo(f, pl) {
        seekFrac = Math.max(0, Math.min(1, f));
        pl.dragging = true;
        pl.dragAt = Date.now();
        var ps = LivePlayers();
        for (var i = 0; i < ps.length; i++) DrawBar(ps[i], seekFrac * 100);
        $.Schedule(0.32, function () { if (pl.dragging && Date.now() - pl.dragAt >= 300) EndDrag(pl); });
    }

    function EndDrag(pl) {
        if (!pl.dragging) return;
        pl.dragging = false;
        np.pct = seekFrac * 100;
        if (currentDuration > 0) {
            prog.cur = Math.min(seekFrac * currentDuration, currentDuration - 3);
            prog.at = Date.now();
            seekTarget = prog.cur;
            seekAt = Date.now();
        }
        SendSeek();
    }

    function AnyDragging() {
        var ps = LivePlayers();
        for (var i = 0; i < ps.length; i++) if (ps[i].dragging) return true;
        return false;
    }

    function SendSeek() {
        if (currentDuration <= 0) return;
        var sec = Math.round(Math.min(seekFrac * currentDuration, currentDuration - 3) * 10) / 10;
        ExecCEF('window.lkSeek && window.lkSeek(' + sec + ')');
    }

    function DrawBar(p, pct) {
        if (Valid(p.progressFill)) p.progressFill.style.width = pct + '%';
        if (Valid(p.knob)) p.knob.style.marginLeft = (Math.round(pct * (p.barW || 186) / 100) - 3) + 'px';
    }

    var prog = { cur: 0, at: 0 };
    function OnTick(cur, dur) {
        var now = Date.now();
        if (seekTarget >= 0 && now - seekAt < 2500 && Math.abs(cur - seekTarget) > 2) return;
        seekTarget = -1;
        prog.cur = cur;
        prog.at = now;
    }

    function ProgressTick() {
        if (isPlaying && currentDuration > 0 && prog.at && !AnyDragging()) {
            var cur = Math.min(currentDuration, prog.cur + (Date.now() - prog.at) / 1000);
            SetProgress(Math.min(100, cur / currentDuration * 100));
        }
        $.Schedule(0.03, ProgressTick);
    }

    // never gets mouseup after tab is let go
    function CancelHudDrag() {
        var ps = LivePlayers();
        for (var i = 0; i < ps.length; i++) {
            var p = ps[i];
            if (!p.isHud || !Valid(p.progress)) continue;
            EndDrag(p);
            p.progress.enabled = false;
            p.dragAt = 0;
            (function (sl) { $.Schedule(0.05, function () { if (Valid(sl)) sl.enabled = true; }); })(p.progress);
        }
    }

    function SetProgress(pct) {
        np.pct = pct;
        var ps = LivePlayers();
        var now = Date.now();
        for (var i = 0; i < ps.length; i++) {
            var p = ps[i];
            if (p.dragging) continue;
            DrawBar(p, pct);
            if (!Valid(p.progress)) continue;
            p.pushing = true;
            try { p.progress.value = pct * 10; } catch (e) { }
            p.pushing = false;
        }
    }

    function ToggleQuiet() {
        DLMusic.quiet = !DLMusic.quiet;
        fastFade = true;
        ApplyLook();
        DLMusic.log('Quiet mode ' + (DLMusic.quiet ? 'ON (' + S.quietVol + '%)' : 'OFF') + '.');
    }

    function MarqueeTick() {
        var ps = LivePlayers().concat(PeerMarquees());
        var now = Date.now();
        for (var i = 0; i < ps.length; i++) {
            var p = ps[i];
            if (!Valid(p.titleLabel) || !Valid(p.titleClip)) continue;
            var scale = p.titleLabel.actualuiscale_x || 1;
            var over = (p.titleLabel.actuallayoutwidth - p.titleClip.actuallayoutwidth) / scale;
            if (over > 2) {
                if (now >= p.marqPauseUntil) {
                    if (p.marqAtEnd) {
                        p.marqOffset = 0;
                        p.marqAtEnd = false;
                        p.marqPauseUntil = now + MARQ_START_PAUSE;
                    } else {
                        p.marqOffset += MARQ_SPEED * MARQ_TICK;
                        if (p.marqOffset >= over) {
                            p.marqOffset = over;
                            p.marqAtEnd = true;
                            p.marqPauseUntil = now + MARQ_END_PAUSE;
                        }
                    }
                    p.titleLabel.style.marginLeft = (-Math.round(p.marqOffset)) + 'px';
                }
            } else if (p.centerShort) {
                p.marqOffset = 0;
                p.titleLabel.style.marginLeft = Math.max(0, Math.round(-over / 2)) + 'px';
            } else if (p.marqOffset !== 0) {
                p.marqOffset = 0;
                p.titleLabel.style.marginLeft = '0px';
            }
        }
        $.Schedule(MARQ_TICK, MarqueeTick);
    }

    var vizCur = [1, 1, 1, 1, 1];
    var vizRealAt = 0;
    var vizBands = [0.6, 0.6, 0.6, 0.6, 0.6];

    function VizLayout(b) {
        if (S.vizPos === 'right') return [b[4], b[3], b[2], b[1], b[0]];
        if (S.vizPos === 'center') {
            var edge = (b[3] + b[4]) / 2, mid = (b[1] + b[2]) / 2;
            return [edge, mid, b[0], mid, edge];
        }
        return [b[0], b[1], b[2], b[3], b[4]];
    }

    function VizTick() {
        var show = !!S.visualizer && currentSource !== 'folder';
        var ps = LivePlayers();
        var i, j;
        for (j = 0; j < ps.length; j++) {
            var p = ps[j];
            if (p.vizShown === show || !Valid(p.vizSlot)) continue;
            p.vizShown = show;
            p.vizSlot.style.visibility = show ? 'visible' : 'collapse';
            if (Valid(p.artistLabel)) p.artistLabel.SetHasClass('DLMArtistFull', !show);
        }
        if (show) {
            var now = Date.now();
            if (!isPlaying || !vizLive || now - vizRealAt > 400) {
                for (i = 0; i < 5; i++) vizBands[i] = 0.6;
            }
            if (isPlaying && vizLive && !(DLMusic.isMenuOpen && DLMusic.isMenuOpen())) {
                if (!vizWinEnd) { vizWinEnd = now + 10000; vizCount = 0; }
                else if (now >= vizWinEnd) {
                    if (vizReports < 12) { vizReports++; DevLog('Visualizer: ' + vizCount + ' updates in 10s with the menu closed.'); }
                    vizWinEnd = 0;
                }
            }
            var gain = Math.max(0.1, S.vizSens / 100);
            var follow = 0.85 - 0.75 * Math.max(0, Math.min(1, S.vizSmooth / 100));
            var laid = VizLayout(vizBands);
            for (i = 0; i < 5; i++) {
                var t = Math.max(0.6, Math.min(9, laid[i] * gain));
                vizCur[i] += (t - vizCur[i]) * follow;
            }
            for (j = 0; j < ps.length; j++) {
                for (i = 0; i < 5; i++) {
                    var bar = ps[j].vizBars[i];
                    if (Valid(bar)) bar.style.height = Math.round(2 + vizCur[i] * 1.55) + 'px';
                }
            }
        }
        $.Schedule(0.05, VizTick);
    }

    var vizLive = false, vizCount = 0, vizWinEnd = 0, vizReports = 0;
    function OnVizStat(d) {
        DevLog('Visualizer page: ' + (d.live ? 'reading' : 'not reading') + ', audio ' + d.state + ', ' + d.sent + ' sent (' + d.zero + ' silent), levels ' + (d.last || '-') + ', volume ' + d.vol + (d.muted ? ' muted' : '') + (d.hold ? ', ad' : '') + (d.tagged ? '' : ', not hooked') + '. HUD ' + (vizLive ? 'live' : 'not live') + ', ' + (isPlaying ? 'playing' : 'paused') + '.');
        if (d.live && !vizLive) vizLive = true;
    }

    function OnVizLevels(str) {
        if (!str) return;
        vizRealAt = Date.now();
        vizCount++;
        for (var i = 0; i < 5 && i < str.length; i++) vizBands[i] = Math.max(0.6, parseInt(str.charAt(i), 10) || 0);
    }

    // dont resize, goes blank till hovered
    function ApplyBrowserStyle() {
        if (!Valid(cefPanel)) return;
        var s = cefPanel.style;
        s.width = BROWSER_W + 'px';
        s.height = BROWSER_H + 'px';
        s.horizontalAlign = 'center';
        s.verticalAlign = 'center';
        s.margin = BROWSER_DY + 'px 0px 0px ' + BROWSER_DX + 'px';
        s.zIndex = browserVisible ? '1000' : '0';
        s.opacity = browserVisible ? '0.99' : '0';
        cefPanel.hittest = browserVisible;
        if (Valid(browserFrame)) browserFrame.style.visibility = browserVisible ? 'visible' : 'collapse';
    }

    function ZoomValue() {
        if (S.browserZoom > 0) return S.browserZoom / 100;
        var sc = Valid(cefPanel) ? (cefPanel.actualuiscale_y || 1) : 1;
        if (sc >= 0.95) return 1;
        return Math.round(Math.min(1.5, 1 / sc) * 20) / 20;
    }

    var zoomSent = '';
    function SendZoom() {
        if (!bridgeOk) return;
        var z = ZoomValue();
        var key = currentSource + '|' + z;
        if (key === zoomSent) return;
        zoomSent = key;
        DevLog('Browser zoom ' + Math.round(z * 100) + '% (' + (S.browserZoom > 0 ? 'set' : 'auto') + ', UI scale ' + (Valid(cefPanel) ? cefPanel.actualuiscale_y : '?') + ').');
        ExecCEF('window.lkZoom && window.lkZoom(' + z + ')');
        if (browserVisible) RepaintNudge();
    }
    DLMusic.zoomLabel = function () { return S.browserZoom > 0 ? S.browserZoom + '%' : 'Auto'; };
    DLMusic.cycleZoom = function () {
        var order = [0, 50, 75, 100, 125, 150];
        var i = order.indexOf(S.browserZoom);
        S.browserZoom = order[(i + 1) % order.length];
        if (DLMusic.settingsChanged) DLMusic.settingsChanged();
    };

    function SetBrowserVisible(on) {
        if (browserVisible === !!on && Valid(cefPanel)) return;
        browserVisible = !!on;
        EnsureCEFPanel();
        ApplyBrowserStyle();
        if (browserVisible) RepaintNudge();
    }

    // force a redraw or it stays blank
    function RepaintNudge() {
        var nudge = function () {
            if (!browserVisible || !Valid(cefPanel)) return;
            ExecCEF('window.lkRepaint && window.lkRepaint()');
            cefPanel.style.opacity = cefPanel.style.opacity === '1' ? '0.99' : '1';
        };
        $.Schedule(0.05, nudge);
        $.Schedule(0.3, nudge);
        $.Schedule(0.8, nudge);
        $.Schedule(1.6, nudge);
    }

    var lightPage = false;
    var startup = true;

    function EnsureCEFPanel(light) {
        if (Valid(cefPanel)) {
            if (!light && lightPage) {
                startup = false;
                lightPage = false;
                DLMusic.log('Menu opened, loading ' + S.source + '.');
                LoadSource(S.source);
            }
            if (!light) startup = false;
            return cefPanel;
        }
        var ctx = null;
        try { ctx = $.GetContextPanel(); } catch (e) { ctx = null; }
        if (!ctx) return null;

        cefPanel = ctx.FindChildTraverse('DLMusicCEF');
        if (!cefPanel) {
            browserFrame = $.CreatePanel('Panel', ctx, 'DLMusicBrowserFrame');
            browserFrame.AddClass('DLMBrowserFrame');
            browserFrame.hittest = false;
            browserFrame.style.visibility = 'collapse';

            cefPanel = $.CreatePanel('CitadelHTMLPanel', ctx, 'DLMusicCEF');
            ApplyBrowserStyle();
            $.RegisterEventHandler('HTMLTitle', cefPanel, function (p, title) {
                HandleCEFMessage(title);
            });
            currentSource = 'youtube';
            pageSeen = false;
            bridgeOk = false;
            $.Schedule(2.0, BridgeWatchdog);
            if (light) {
                lightPage = true;
                cefPanel.SetURL(YT_LIGHT);
                DLMusic.log('Browser created on a small page (settings and sharing).');
                $.Schedule(2.5, function () { if (lightPage && !bridgeOk) { pageSeen = true; ExecCEF(BuildBridge()); } });
            } else {
                startup = false;
                cefPanel.SetURL(YT_HOME);
                DLMusic.log('Browser created, loading YouTube.');
            }
        } else {
            browserFrame = ctx.FindChildTraverse('DLMusicBrowserFrame');
        }
        return cefPanel;
    }

    function SwitchSource(src) {
        if (!Valid(cefPanel)) { currentSource = src; return; }
        if (lightPage && startup) {
            if (src !== 'folder' || !S.rememberSong) return;
            lightPage = false;
        }
        LoadSource(src);
    }

    var loadedFolder = '';
    DLMusic.folderInfo = null;

    function FolderUrl(path) {
        var p = String(path).replace(/\\/g, '/').replace(/\/+$/, '');
        return 'file:///' + encodeURI(p) + '/';
    }

    var folderTry = 0, folderGuess = -1, folderTrying = '';
    var folderList = STEAM_GUESSES.slice(0);
    var vdfTry = 0;

    function OpenVdf() {
        folderTrying = '';
        DLMusic.folderInfo = { loading: true };
        pageSeen = false;
        bridgeOk = false;
        lastBridgeMsgMs = 0;
        injectCount = 0;
        var token = ++vdfTry;
        ++folderTry;
        DLMusic.log("Music folder: reading Steam's library list.");
        cefPanel.SetURL('file:///' + encodeURI(STEAM_VDF));
        $.Schedule(2.0, function () { if (token === vdfTry && !bridgeOk) { pageSeen = true; ExecCEF(BuildBridge()); } });
        $.Schedule(4.5, function () {
            if (token !== vdfTry || currentSource !== 'folder' || folderGuess >= 0 || folderTrying) return;
            DLMusic.log("Music folder: couldn't read Steam's library list.");
            folderGuess = 0;
            OpenFolder(folderList[0] + FOLDER_TAIL);
        });
    }

    function OnVdf(paths) {
        if (currentSource !== 'folder' || folderGuess >= 0 || folderTrying) return;
        var list = [], seen = {};
        var all = (paths || []).concat(STEAM_GUESSES);
        for (var i = 0; i < all.length; i++) {
            var p = String(all[i] || '').replace(/\\/g, '/').replace(/\/+$/, '');
            if (!p || seen[p.toLowerCase()]) continue;
            seen[p.toLowerCase()] = 1;
            list.push(p);
        }
        folderList = list;
        DLMusic.log('Music folder: Steam lists ' + (paths || []).length + ' library folder(s).');
        folderGuess = 0;
        OpenFolder(folderList[0] + FOLDER_TAIL);
    }

    function OpenFolder(path) {
        folderTrying = path;
        loadedFolder = S.folderPath;
        DLMusic.folderInfo = { loading: true };
        pageSeen = false;
        bridgeOk = false;
        lastBridgeMsgMs = 0;
        injectCount = 0;
        var token = ++folderTry;
        DLMusic.log('Music folder: trying ' + path);
        cefPanel.SetURL(FolderUrl(path));
        $.Schedule(4.0, function () {
            if (token !== folderTry || currentSource !== 'folder') return;
            if (DLMusic.folderInfo && DLMusic.folderInfo.loading) FolderFailed('no folder page');
        });
    }

    function FolderFailed(why) {
        if (folderGuess >= 0 && folderGuess + 1 < folderList.length) {
            folderGuess++;
            OpenFolder(folderList[folderGuess] + FOLDER_TAIL);
            return;
        }
        folderGuess = -1;
        DLMusic.folderInfo = { missing: true };
        DLMusic.log('Music folder: not found (' + why + ').');
    }

    function FolderPage(d) {
        if (d.rescan) return;
        var isFolder = String(d.title || '').indexOf('Index of') === 0;
        var loading = DLMusic.folderInfo && DLMusic.folderInfo.loading;
        if (!isFolder) { if (loading) FolderFailed('not a folder'); return; }
        DLMusic.folderInfo = { count: d.count, skipped: d.skipped || 0 };
        if (loading && (folderGuess >= 0 || !S.folderPath)) {
            folderGuess = -1;
            S.folderPath = folderTrying;
            loadedFolder = folderTrying;
            DLMusic.log('Music folder: found ' + folderTrying);
            if (DLMusic.settingsChanged) DLMusic.settingsChanged();
        }
    }

    DLMusic.reloadBrowser = function () {
        if (!Valid(cefPanel)) return;
        DLMusic.log('Browser: reloading ' + currentSource + '.');
        LoadSource(currentSource);
    };

    DLMusic.reloadFolder = function () {
        if (currentSource !== 'folder') return;
        var fi = DLMusic.folderInfo;
        if (!fi || fi.missing || fi.blocked || !bridgeOk) LoadSource('folder');
        else ExecCEF('window.lkRefresh && window.lkRefresh()');
    };

    function LoadSource(src) {
        currentSource = src;
        shareCode = '';
        lastSentArg = null;
        pageSeen = false;
        bridgeOk = false;
        lastBridgeMsgMs = 0;
        injectCount = 0;
        SetPlaying(false);
        SetTitle('');
        SetArtist('');
        SetArt('');
        SetProgress(0);
        prog.cur = 0;
        prog.at = 0;
        vizLive = false;
        zoomSent = '';
        metaId = '';
        artId = '';
        artCand = '';
        ApplyLook();
        DLMusic.log('Source: switching to ' + src + '.');
        if (src === 'folder') {
            if (S.folderPath) { folderGuess = -1; OpenFolder(S.folderPath); }
            else { folderGuess = -1; OpenVdf(); }
            return;
        }
        cefPanel.SetURL(YT_HOME);
    }

    function ExecCEF(js) {
        if (!Valid(cefPanel)) return;
        try { cefPanel.SetURL('javascript:' + js); } catch (e) { }
    }

    var YT_CSS = [
        '::-webkit-scrollbar { width: 0px; height: 0px; }',
        'ytd-rich-shelf-renderer[is-shorts], ytd-reel-shelf-renderer { display: none !important; }',
        '[id=voice-search-button] { display: none !important; }'
    ];

    var AD_SELECTORS = [
        'ytd-ad-slot-renderer', 'ytd-in-feed-ad-layout-renderer', 'ytd-banner-promo-renderer',
        'ytd-statement-banner-renderer', 'ytd-promoted-sparkles-web-renderer',
        'ytd-promoted-video-renderer', 'ytd-display-ad-renderer', 'ytd-compact-promoted-video-renderer',
        'ytd-action-companion-ad-renderer', 'ytd-player-legacy-desktop-watch-ads-renderer',
        'ytd-merch-shelf-renderer', '.ytp-ad-overlay-container', '.ytp-ad-image-overlay',
        'ytd-engagement-panel-section-list-renderer[target-id=engagement-panel-ads]'
    ];

    function BuildCss() {
        var ads = AD_SELECTORS.map(function (s) { return 'html.dlmnoads ' + s; }).join(', ');
        return YT_CSS.join(' ') + ' ' + ads + ' { display: none !important; } ' +
            'html.dlmnoads ytd-rich-item-renderer:has(ytd-ad-slot-renderer) { display: none !important; }';
    }

    // goes in a javascript: url, no % or #
    function BridgeCommon(vol, optsJson, host, fresh) {
        var guard = host === 'file:' ? "if (location.protocol !== 'file:') { return; }" : "if (location.hostname.indexOf('" + host + "') < 0) { return; }";
        return [
            guard,
            "if (window.__dlm) { try { (window.__dlmSetTitle || function(v) { document.title = v; })(JSON.stringify({ t: 'alive', d: { at: Date.now() } })); } catch(e) {} return; }",
            "window.__dlm = 1;",
            "var wantVol = " + vol + ";",
            "var opts = " + optsJson + ";",
            "var n = 0;",
            // talk through document.title, yt keeps overwriting it
            "var pageTitle = document.title;",
            "var titleDesc = null; try { titleDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'title'); } catch(e) {}",
            "var ourTitle = '';",
            "function setTitle(v) { ourTitle = v; try { if (titleDesc && titleDesc.set) titleDesc.set.call(document, v); else document.title = v; } catch(e) {} }",
            "window.__dlmSetTitle = setTitle;",
            "try { Object.defineProperty(document, 'title', { configurable: true, get: function() { return ourTitle || pageTitle; }, set: function(v) { pageTitle = String(v); } }); } catch(e) {}",
            "try {",
            "  new MutationObserver(function() {",
            "    var el = document.querySelector('title');",
            "    if (ourTitle && el && el.textContent !== ourTitle) setTitle(ourTitle);",
            "  }).observe(document.head || document.documentElement, { childList: true, subtree: true, characterData: true });",
            "} catch(e) {}",
            "var outQ = [], outAt = 0, outT = null;",
            "function flushOut() {",
            "  outT = null;",
            "  if (!outQ.length) return;",
            "  var wait = 70 - (Date.now() - outAt);",
            "  if (wait > 0) { outT = setTimeout(flushOut, wait); return; }",
            "  outAt = Date.now();",
            "  setTitle(outQ.shift());",
            "  if (outQ.length) outT = setTimeout(flushOut, 70);",
            "}",
            "function send(t, d) {",
            "  outQ.push(JSON.stringify({ t: t, d: d || {} }));",
            "  if (outQ.length > 40) outQ.splice(0, outQ.length - 40);",
            "  if (!outT) flushOut();",
            "}",
            "var pid = Math.floor(Math.random() * 1e9).toString(36), relN = 0, relQ = {};",
            "function sendSure(t, d) { d = d || {}; d.q = pid + '-' + (++relN); relQ[d.q] = { t: t, d: d, tries: 0 }; send(t, d); }",
            "window.lkAck = function(q) { delete relQ[q]; };",
            "setInterval(function() { for (var k in relQ) { var m = relQ[k]; if (++m.tries > 12) { delete relQ[k]; continue; } send(m.t, m.d); } }, 600);",
            "var RELAY = '" + RELAY_URL + "';",
            "var peer = { ws: null, open: false, room: '', key: null, note: '', want: false, ping: null, retry: null, fails: 0, sentReal: false, lastSend: 0, sendT: null };",
            "function unhex(h) { var p = String(h || '').split('-'), out = ''; for (var i = 0; i < p.length; i++) if (p[i]) out += String.fromCharCode(parseInt(p[i], 16)); return out; }",
            "function b64(u) { var t = ''; for (var i = 0; i < u.length; i++) t += String.fromCharCode(u[i]); return btoa(t); }",
            "function unb64(t) { var r = atob(t), u = new Uint8Array(r.length); for (var i = 0; i < r.length; i++) u[i] = r.charCodeAt(i); return u; }",
            "function sha(t) { return crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)); }",
            "function hexOf(buf) { var a = new Uint8Array(buf), h = ''; for (var i = 0; i < a.length; i++) h += (a[i] < 16 ? '0' : '') + a[i].toString(16); return h; }",
            "function peerClose() {",
            "  var ws = peer.ws; peer.ws = null; peer.open = false; peer.room = ''; peer.key = null;",
            "  if (peer.ping) { clearInterval(peer.ping); peer.ping = null; }",
            "  if (peer.retry) { clearTimeout(peer.retry); peer.retry = null; }",
            "  if (peer.sendT) { clearTimeout(peer.sendT); peer.sendT = null; }",
            "  peer.fails = 0; peer.sentReal = false; peer.lastReal = '';",
            "  if (ws) { try { ws.close(); } catch(e) {} sendSure('peerstate', { on: false }); }",
            "}",
            "function peerSendNote() {",
            "  if (!peer.ws || !peer.open || !peer.key) return;",
            "  if (!peer.note && !peer.sentReal) return;",
            // relay drops notes < 2s apart
            "  var wait = 2200 - (Date.now() - peer.lastSend);",
            "  if (wait > 0) { if (!peer.sendT) peer.sendT = setTimeout(function() { peer.sendT = null; peerSendNote(); }, wait); return; }",
            "  peer.lastSend = Date.now();",
            "  var real = !!peer.note;",
            "  var last = {}; try { last = JSON.parse(peer.lastReal || '{}'); } catch(e) {}",
            "  var body = peer.note ? notePos(peer.note) : JSON.stringify({ off: 1, h: last.h || '', n: last.n || '' });",
            "  if (real) peer.lastReal = peer.note;",
            "  var iv = crypto.getRandomValues(new Uint8Array(12)); var ws = peer.ws;",
            "  crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, peer.key, new TextEncoder().encode(body)).then(function(ct) {",
            "    var all = new Uint8Array(12 + ct.byteLength); all.set(iv, 0); all.set(new Uint8Array(ct), 12);",
            "    try { ws.send(b64(all)); if (real) peer.sentReal = true; sendSure('peersent', { off: !real }); } catch(e) {}",
            "  });",
            "}",
            "function peerRecv(t, age) {",
            "  if (!peer.key || t.length > 600) return;",
            "  var all; try { all = unb64(t); } catch(e) { return; }",
            "  if (all.length < 29) return;",
            "  crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, peer.key, all.slice(12)).then(function(pt) {",
            "    var o = JSON.parse(new TextDecoder().decode(pt));",
            "    var nm = String(o.n || '').substring(0, 40); var hr = String(o.h || '').substring(0, 40);",
            "    if (!nm && !hr) return;",
            "    var m = /^y:([A-Za-z0-9_-]{11})$/.exec(String(o.c || ''));",
            "    var bs = String(o.b || ''); if (!/^(gold|silver|dark|neon|glass|off)$/.test(bs)) bs = '';",
            "    var ps = Number(o.p); if (!(ps >= 0 && ps < 36000)) ps = -1;",
            "    sendSure('peer', { n: nm, h: hr, id: m ? m[1] : '', t: String(o.t || '').replace(/[\\u0000-\\u001f]/g, '').substring(0, 60), off: !!o.off, b: bs, p: ps, age: Math.min(3600000, Math.max(0, Number(age) || 0)) });",
            "  }).catch(function() {});",
            "}",
            "function peerConnect() {",
            "  if (!peer.room || !peer.key || peer.ws) return;",
            "  var ws; try { ws = new WebSocket(RELAY + peer.room); } catch(e) { return; }",
            "  peer.ws = ws;",
            "  ws.onopen = function() {",
            "    if (peer.ws !== ws) return;",
            "    peer.open = true; peer.fails = 0; sendSure('peerstate', { on: true, room: peer.room.substring(0, 6) });",
            "    peerSendNote();",
            "    peer.ping = setInterval(function() { try { ws.send('ping'); } catch(e) {} }, 240000);",
            "  };",
            "  ws.onmessage = function(e) { var t = String(e.data); if (t === 'pong') return; if (t.indexOf('age:') === 0) { peer.age = Number(t.substring(4)) || 0; return; } var age = peer.age || 0; peer.age = 0; peerRecv(t, age); };",
            "  ws.onclose = function() {",
            "    if (peer.ws !== ws) return;",
            "    peer.ws = null; peer.open = false;",
            "    if (peer.ping) { clearInterval(peer.ping); peer.ping = null; }",
            "    sendSure('peerstate', { on: false });",
            "    peer.fails++;",
            "    var delays = [8000, 30000, 120000, 300000];",
            "    if (peer.want && peer.room && peer.fails <= 5) peer.retry = setTimeout(function() { peer.retry = null; peerConnect(); }, delays[Math.min(peer.fails - 1, delays.length - 1)]);",
            "  };",
            "}",
            "window.lkPeer = function(roomHex, noteHex, show) {",
            "  if (!window.crypto || !crypto.subtle || !window.WebSocket) return;",
            "  var src = unhex(roomHex); var note = unhex(noteHex);",
            "  peer.want = !!(src && (show || note));",
            "  if (!peer.want) { peerClose(); peer.note = note; return; }",
            "  sha('dlr-room|' + src).then(function(rb) {",
            "    var r = hexOf(rb);",
            "    if (r === peer.room) { if (note !== peer.note) { peer.note = note; peerSendNote(); } return; }",
            "    peerClose(); peer.note = note; peer.room = r;",
            "    return sha('dlr-note|anrKvZKLlQaJZu1ScaK9kM9z|' + r).then(function(kb) {",
            "      return crypto.subtle.importKey('raw', kb, 'AES-GCM', false, ['encrypt', 'decrypt']);",
            "    }).then(function(k) { if (peer.room !== r) return; peer.key = k; peerConnect(); });",
            "  }).catch(function() {});",
            "};",
            "function notePos(body) { try { var o = JSON.parse(body); if (o.c && typeof curPos === 'function') { o.p = Math.max(0, Math.round(curPos())); return JSON.stringify(o); } } catch(e) {} return body; }",
            "var zoomNow = Number(opts.zoom) || 1; var baseCols = 0; var colStyle = null;",
            "function fitCols() {",
            "  try {",
            "    var g = document.querySelector('ytd-rich-grid-renderer'); if (!g) return;",
            "    if (!colStyle) { colStyle = document.createElement('style'); document.head.appendChild(colStyle); }",
            "    if (!baseCols && !colStyle.textContent) baseCols = parseInt(getComputedStyle(g).getPropertyValue('--ytd-rich-grid-items-per-row'), 10) || 0;",
            "    var base = baseCols || 3;",
            "    var want = zoomNow > 1.01 ? Math.max(1, Math.floor(base / zoomNow)) : (zoomNow < 0.99 ? Math.ceil(base / zoomNow) : 0);",
            "    var css = want ? 'ytd-rich-grid-renderer { --ytd-rich-grid-items-per-row: ' + want + ' !important; } ytd-rich-grid-row, ytd-rich-grid-row > [id=contents] { display: contents !important; }' : '';",
            "    if (colStyle.textContent !== css) colStyle.textContent = css;",
            "  } catch(e) {}",
            "}",
            "window.lkZoom = function(z) { zoomNow = Number(z) || 1; try { if (document.documentElement.style.zoom !== String(zoomNow)) document.documentElement.style.zoom = String(zoomNow); } catch(e) {} fitCols(); };",
            "try { document.documentElement.style.zoom = String(zoomNow); } catch(e) {}",
            "setInterval(fitCols, 1500);",
            "var API = '" + API_URL + "';",
            "function cleanNotes(ns) {",
            "  if (!Array.isArray(ns)) return null;",
            "  var t = function(x, n) { return String(x == null ? '' : x).replace(/[\\u0000-\\u001f]/g, ' ').substring(0, n); };",
            "  var list = function(a) { return Array.isArray(a) ? a.slice(0, 25).map(function(x) { return t(x, 220); }) : []; };",
            "  return ns.slice(0, 12).map(function(o) { o = o || {}; return { v: t(o.v, 20), n: list(o.n), f: list(o.f) }; });",
            "}",
            "window.lkVer = function() {",
            "  fetch(API + 'v/" + API_KEY + (DEV_BUILD ? "?ch=dev" : "") + "', { cache: 'no-store' }).then(function(r) { return r.ok ? r.json() : null; })",
            "    .then(function(j) { if (j && j.v) sendSure('ver', { v: String(j.v).substring(0, 20), notes: cleanNotes(j.notes) }); }).catch(function() {});",
            "};",
            "window.lkFeedback = function(h) {",
            "  fetch(API + 'f/" + API_KEY + "', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: unhex(h) })",
            "    .then(function(r) { sendSure('fbsent', { ok: !!r.ok }); }).catch(function() { sendSure('fbsent', { ok: false }); });",
            "};",
            "var fresh = " + (fresh ? 'true' : 'false') + ";",
            "window.lkRepaint = function() {",
            "  try { window.dispatchEvent(new Event('resize')); document.documentElement.classList.toggle('dlmrp'); window.scrollBy(0, 1); window.scrollBy(0, -1); } catch(e) {}",
            "};",
            "try {",
            "  Object.defineProperty(document, 'hidden', { configurable: true, get: function() { return false; } });",
            "  Object.defineProperty(document, 'visibilityState', { configurable: true, get: function() { return 'visible'; } });",
            "  document.dispatchEvent(new Event('visibilitychange'));",
            "} catch(e) {}",
            "function saveOpts() { try { localStorage.setItem('dlm_settings', JSON.stringify(opts)); } catch(e) { send('error', { msg: 'save failed' }); } }"
        ];
    }

    function BridgeTail() {
        return [
            "var saved = null;",
            "try { saved = JSON.parse(localStorage.getItem('dlm_settings') || 'null'); } catch(e) {}",
            "send('bridge', { href: location.href, saved: saved });"
        ];
    }

    function VizLines() {
        return [
            "function vizSetup(v) {",
            "  if (!opts.visualizer) { send('viz', { step: 'off' }); return; }",
            "  if (!v || v.__dlmViz) return;",
            "  v.__dlmViz = 1;",
            "  try {",
            "    var AC = window.AudioContext || window.webkitAudioContext;",
            "    if (!AC) { send('viz', { ok: false, why: 'no AudioContext' }); return; }",
            "    var ctx = new AC();",
            "    send('viz', { step: 'created', state: ctx.state });",
            "    setTimeout(function() { if (ctx.state !== 'running') send('viz', { step: 'waiting for a click in the Browser tab', state: ctx.state }); }, 2000);",
            "    ctx.resume().then(function() {",
            "      if (ctx.state !== 'running') { v.__dlmViz = 0; send('viz', { ok: false, why: ctx.state }); try { ctx.close(); } catch(e) {} return; }",
            "      var src = ctx.createMediaElementSource(v); var an = ctx.createAnalyser();",
            "      an.fftSize = 512; an.smoothingTimeConstant = 0.5;",
            "      src.connect(an); an.connect(ctx.destination);",
            "      viz = { ctx: ctx, an: an, buf: new Uint8Array(an.frequencyBinCount), vol: -1, heard: 0, since: Date.now() };",
            "      send('viz', { ok: true });",
            "    }).catch(function(e) { v.__dlmViz = 0; send('viz', { ok: false, why: e.name }); });",
            "  } catch(e) { send('viz', { ok: false, why: e.name }); }",
            "}",
            "var BANDS = [[1, 2], [3, 5], [6, 12], [13, 30], [31, 80]];",
            "setInterval(function() {",
            "  if (!viz || !opts.visualizer || vizHold()) return;",
            "  var v = vizEl(); if (!v || v.paused) return;",
            "  if (viz.ctx.state !== 'running') { try { viz.ctx.resume(); } catch(e) {} return; }",
            "  if (!viz.peak) { viz.peak = [0, 0, 0, 0, 0]; viz.an.minDecibels = -100; viz.an.maxDecibels = -20; }",
            "  viz.an.getByteFrequencyData(viz.buf);",
            "  var out = '', any = 0;",
            "  for (var i = 0; i < BANDS.length; i++) {",
            "    var s = 0, c = 0;",
            "    for (var j = BANDS[i][0]; j <= BANDS[i][1]; j++) { s += viz.buf[j]; c++; }",
            "    any += s;",
            "    var avg = s / c;",
            "    viz.peak[i] = Math.max(avg, viz.peak[i] * 0.992);",
            "    out += viz.peak[i] < 8 ? 0 : Math.min(9, Math.floor(avg / viz.peak[i] * 9.4));",
            "  }",
            "  viz.last = out;",
            "  if (any > 0) viz.heard = Date.now();",
            "  viz.play = (viz.play || 0) + 70;",
            // local files come out silent
            "  if (location.protocol === 'file:' && !viz.heard && viz.play > 8000) { send('viz', { ok: false, why: 'silent' }); viz = null; return; }",
            "  viz.sent = (viz.sent || 0) + 1; if (!any) viz.zero = (viz.zero || 0) + 1;",
            "  send('v', { b: out });",
            "}, 70);",
            "var vizRep = " + (DEV_BUILD ? 0 : 99) + ";",
            "setInterval(function() {",
            "  if (vizRep >= 12 || !opts.visualizer) return;",
            "  var v = vizEl(); if (!v || v.paused) return;",
            "  vizRep++;",
            "  send('vizstat', { live: !!viz, state: viz ? viz.ctx.state : 'none', sent: viz ? (viz.sent || 0) : 0, zero: viz ? (viz.zero || 0) : 0, hold: !!vizHold(), vol: Math.round((v.volume || 0) * 100), muted: !!v.muted, tagged: !!v.__dlmViz, last: viz ? String(viz.last || '') : '' });",
            "  if (viz) { viz.sent = 0; viz.zero = 0; }",
            "}, 20000);"
        ];
    }

    function BuildYTBridge(vol, optsJson, fresh) {
        var lines = ["(function(){"].concat(BridgeCommon(vol, optsJson, 'youtube.com', fresh), VizLines(), [
            "var hooked = null; var lastId = ''; var adWas = false;",
            "var adSince = 0; var adReloadAt = 0; var mainTime = 0; var mainTimeId = '';",
            "var viz = null; var metaTryId = ''; var metaTries = 0; var keepSpotId = ''; var seekedAt = 0;",
            "var hist = []; try { hist = JSON.parse(sessionStorage.getItem('dlm_hist') || '[]'); } catch(e) { hist = []; }",
            "var histSkip = false;",
            "function saveHist() { try { sessionStorage.setItem('dlm_hist', JSON.stringify(hist.slice(-50))); } catch(e) {} }",
            "function urlId() { try { return new URLSearchParams(location.search).get('v') || ''; } catch(e) { return ''; } }",
            "function P() { return document.getElementById('movie_player'); }",
            "function V() { var p = P(); return p ? p.querySelector('video') : null; }",
            "function onWatch() { return location.pathname.indexOf('/watch') === 0; }",
            "function vizEl() { return V(); }",
            "function vizHold() { return adWas; }",
            "function curPos() { var v = V(); return v && !adWas ? v.currentTime : 0; }",
            "function curId() { var p = P(); var md = p && p.getVideoData ? p.getVideoData() : null; return md && md.video_id ? md.video_id : urlId(); }",
            "var healOnly = false;",
            "window.lkMeta = function() { lastId = ''; metaTryId = ''; metaTries = 0; healOnly = true; };",
            "var urlSeen = '', urlAt = Date.now();",
            "function keepAt(id, at) { keepSpotId = id; try { sessionStorage.setItem('dlm_keep', JSON.stringify({ id: id, at: at || 0, t: Date.now() })); } catch(e) {} }",
            "try { var kp = JSON.parse(sessionStorage.getItem('dlm_keep') || 'null'); if (kp && Date.now() - kp.t < 30000) keepSpotId = kp.id; } catch(e) {}",
            "function applyOpts() { document.documentElement.classList.toggle('dlmnoads', !!opts.skipAds); }",
            "try { var st = document.createElement('style'); st.textContent = " + JSON.stringify(BuildCss()) + "; document.head.appendChild(st); } catch(e) {}",
            "applyOpts();",
            "var stillAt = 0;",
            "setInterval(function() {",
            "  try { window._lact = Date.now(); document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })); } catch(e) {}",
            "  var dl = document.querySelector('yt-confirm-dialog-renderer');",
            "  if (!dl || dl.offsetParent === null || Date.now() - stillAt < 5000) return;",
            "  var v = V(); if (!v || !v.paused) return;",
            "  var b = dl.querySelector('[id=confirm-button] button') || dl.querySelector('[id=confirm-button]');",
            "  if (!b) return;",
            "  stillAt = Date.now(); b.click();",
            "  var p = P(); if (p && p.playVideo) p.playVideo();",
            "  send('still');",
            "}, 2000);",
            "function unmuteNow() {",
            "  if (adWas) return;",
            "  var p = P(); var v = V();",
            "  if (v) v.muted = false;",
            "  if (p && p.unMute) p.unMute();",
            "  if (p && p.setVolume) p.setVolume(wantVol);",
            "}",
            "var holdPlay = false;",
            "document.addEventListener('pointerdown', function() { holdPlay = false; }, true);",
            "document.addEventListener('keydown', function() { holdPlay = false; }, true);",
            "function startPlayback() {",
            "  if (holdPlay) return;",
            "  var v = V(); if (!v) return;",
            "  if (!v.paused && !v.muted) { unmuteNow(); return; }",
            "  v.muted = true;",
            "  var pr = v.play();",
            "  if (pr && pr.then) {",
            "    pr.then(function() { if (!adWas) unmuteNow(); send('unmuted'); })",
            "      .catch(function(e) { send('error', { msg: 'play rejected ' + e.name }); });",
            "  } else { unmuteNow(); }",
            "}",
            "function clickSel(sel) { var b = document.querySelector(sel); if (b && b.offsetParent !== null) { b.click(); return true; } return false; }",
            "window.lkPlay = function() { if (holdPlay) { holdPlay = false; var v0 = V(); if (v0) v0.muted = false; } var p = P(); if (p && p.playVideo) { p.playVideo(); } else { var v = V(); if (v) v.play(); } };",
            "window.lkPause = function() { var p = P(); if (p && p.pauseVideo) { p.pauseVideo(); } else { var v = V(); if (v) v.pause(); } };",
            "window.lkSetVolume = function(vol) { wantVol = vol; if (adWas) return; var p = P(); if (p && p.setVolume) { p.setVolume(vol); } else { var v = V(); if (v) v.volume = Math.max(0, Math.min(1, vol / 100)); } };",
            "var fadeT = null;",
            "window.lkFadeTo = function(to, sec) {",
            "  if (fadeT) { clearInterval(fadeT); fadeT = null; }",
            "  var from = wantVol; var ms = sec * 1000; var t0 = Date.now();",
            "  if (!(ms > 60)) { window.lkSetVolume(to); return; }",
            "  fadeT = setInterval(function() { var k = Math.min(1, (Date.now() - t0) / ms); window.lkSetVolume(Math.round(from + (to - from) * k)); if (k >= 1) { clearInterval(fadeT); fadeT = null; } }, 50);",
            "};",
            "window.lkNext = function() { if (!clickSel('.ytp-next-button')) { var p = P(); if (p && p.nextVideo) p.nextVideo(); } };",
            "window.lkSeek = function(sec) { var v = V(); if (v && !adWas) { seekedAt = Date.now(); v.currentTime = Math.max(0, Math.min(sec, (v.duration || sec + 3) - 3)); } };",
            "window.lkPlayId = function(id, at) {",
            "  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return;",
            "  at = Math.max(0, Math.floor(Number(at) || 0));",
            "  lastId = ''; metaTryId = ''; metaTries = 0; holdPlay = false;",
            "  if (at > 0) keepAt(id, at);",
            "  var p = P();",
            "  if (p && p.loadVideoById && onWatch()) { if (at > 0) p.loadVideoById({ videoId: id, startSeconds: at }); else p.loadVideoById(id); }",
            "  else { location.href = 'https://www.youtube.com/watch?v=' + id + (at > 0 ? '&t=' + at + 's' : ''); }",
            "  if (at > 0) setTimeout(function() { var v = V(); if (v && v.duration && at > v.duration - 5) { v.currentTime = 0; send('joinlate', { id: id }); } }, 2500);",
            "};",
            "window.lkPrev = function() {",
            "  var v = V();",
            "  if (v && v.currentTime > 3) { v.currentTime = 0; return; }",
            // own history, history.back() can leave yt
            "  if (hist.length < 2) { if (v) v.currentTime = 0; return; }",
            "  hist.pop(); saveHist();",
            "  var prevId = hist[hist.length - 1];",
            "  histSkip = true; lastId = ''; metaTryId = ''; metaTries = 0;",
            "  var p = P(); if (p && p.loadVideoById) p.loadVideoById(prevId); else location.href = 'https://www.youtube.com/watch?v=' + prevId;",
            "};",
            "window.lkSaveSettings = function(o) { opts = o || opts; applyOpts(); saveOpts(); if (opts.visualizer && hooked) vizSetup(hooked); };",
            "function adSkipTry() {",
            "  var p = P(); if (!p) return false;",
            "  var bs = p.querySelectorAll('[class*=skip]');",
            "  for (var i = 0; i < bs.length; i++) { var b = bs[i]; if (b.tagName === 'BUTTON' && b.offsetParent !== null) { b.click(); return true; } }",
            "  return false;",
            "}",
            "setInterval(function() {",
            "  var p = P(); var v = V();",
            "  var ad = !!(p && p.classList && p.classList.contains('ad-showing'));",
            "  if (ad && opts.skipAds) {",
            "    var now = Date.now();",
            "    if (!adWas) { adWas = true; adSince = now; adReloadAt = now + 2000; send('ad', { on: true }); }",
            "    try { if (p.mute) p.mute(); } catch(e) {}",
            "    if (holdPlay && v) { try { v.pause(); } catch(e) {} }",
            "    if (v) { try { v.muted = true; v.volume = 0; if (v.duration && isFinite(v.duration) && v.currentTime < v.duration - 0.3) v.currentTime = v.duration - 0.1; } catch(e) {} }",
            "    adSkipTry();",
            "    if (now >= adReloadAt) {",
            "      var id = urlId();",
            "      if (id && p.loadVideoById) {",
            "        var st = (mainTimeId === id) ? Math.floor(mainTime) : 0;",
            "        send('ad', { how: 'reload', id: id, at: st });",
            "        adReloadAt = now + 4000;",
            "        keepSpotId = id;",
            "        try { p.loadVideoById({ videoId: id, startSeconds: st }); } catch(e) { send('error', { msg: 'reload failed' }); }",
            "      }",
            "    }",
            "  } else if (adWas) {",
            "    adWas = false; send('ad', { on: false, ms: Date.now() - adSince });",
            "    if (v) { try { v.playbackRate = 1; } catch(e) {} }",
            "    unmuteNow();",
            "  }",
            "}, 250);",
            "setInterval(function() {",
            "  n++;",
            "  if (n - Math.floor(n / 6) * 6 === 0) send('hb', { n: n });",
            "  var v = V();",
            "  if (!onWatch() && !(v && v.src && (!v.paused || document.querySelector('ytd-miniplayer[active]')))) return;",
            "  if (v && hooked !== v) {",
            "    hooked = v;",
            "    v.addEventListener('play', function() { if (holdPlay) { v.muted = true; v.pause(); return; } send('play'); });",
            "    v.addEventListener('pause', function() { send('pause'); });",
            "    send('hooked');",
            "    if (sessionStorage.getItem('dlm_resume') === 'pause') { sessionStorage.removeItem('dlm_resume'); holdPlay = true; v.muted = true; v.pause(); send('resumed', { id: urlId(), t: Math.round(v.currentTime || 0) }); }",
            "    else startPlayback();",
            "    setTimeout(function() { vizSetup(v); }, 1500);",
            "  }",
            "  var p = P();",
            "  if (p && p.getVideoData && !adWas) {",
            "    var md = p.getVideoData();",
            "    if (md && md.video_id && md.video_id !== lastId) {",
            "      var ttl = md.title || ''; var aut = md.author || '';",
            "      var mss = navigator.mediaSession && navigator.mediaSession.metadata;",
            "      if (!ttl && mss && mss.title) { ttl = mss.title; aut = aut || mss.artist || ''; }",
            "      if (md.video_id !== metaTryId) { metaTryId = md.video_id; metaTries = 0; }",
            "      metaTries++;",
            "      if (ttl || metaTries > 20) {",
            "        lastId = md.video_id;",
            "        send('meta', { id: md.video_id, title: ttl, author: aut, tries: metaTries });",
            "        var heal = healOnly; healOnly = false;",
            "        if (!heal) { if (histSkip) histSkip = false; else if (hist[hist.length - 1] !== md.video_id) { hist.push(md.video_id); saveHist(); } }",
            // getVideoData is stale right after a switch
            "        (function(vid) {",
            "          fetch('/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + vid))",
            "            .then(function(r) { return r.ok ? r.json() : null; })",
            "            .then(function(j) { if (j && j.title && lastId === vid) send('meta', { id: vid, title: String(j.title), author: String(j.author_name || ''), fixed: true }); })",
            "            .catch(function() {});",
            "        })(md.video_id);",
            "        if (!heal) setTimeout(startPlayback, 1000);",
            "        var vid = md.video_id; var keep = heal || (keepSpotId === vid); if (!heal) keepSpotId = '';",
            "        if (!keep) {",
            "          var toStart = function() { var v2 = V(); if (v2 && !adWas && Date.now() - seekedAt > 3000 && urlId() === vid && v2.currentTime - (Date.now() - urlAt) / 1000 > 3) { v2.currentTime = 0; send('restart', { id: vid }); } };",
            "          toStart(); setTimeout(toStart, 1200);",
            "        }",
            "      }",
            "    }",
            "  }",
            "  if (v && !adWas) { mainTime = v.currentTime || 0; mainTimeId = urlId(); }",
            "  if (v && !adWas && !v.paused && opts.rememberSong && n - Math.floor(n / 10) * 10 === 0) { try { localStorage.setItem('dlm_last', JSON.stringify({ id: curId(), t: Math.floor(v.currentTime || 0) })); } catch(e) {} }",
            "  var u = urlId(); if (u !== urlSeen) { urlSeen = u; urlAt = Date.now(); }",
            "  if (v && !v.paused && !adWas) send('tick', { cur: v.currentTime || 0, dur: v.duration || 0, id: curId(), u: u });",
            "  else if (v && v.paused && n - Math.floor(n / 3) * 3 === 0) send('st', { playing: false });",
            "}, 500);"
        ], BridgeTail(), [
            "if (fresh && saved && saved.rememberSong && !onWatch()) {",
            "  var last = null; try { last = JSON.parse(localStorage.getItem('dlm_last') || 'null'); } catch(e) {}",
            "  if (last && /^[A-Za-z0-9_-]{11}$/.test(String(last.id))) {",
            "    try { sessionStorage.setItem('dlm_resume', 'pause'); } catch(e) {}",
            "    keepAt(last.id, last.t);",
            "    location.href = 'https://www.youtube.com/watch?v=' + last.id + (last.t > 0 ? '&t=' + last.t + 's' : '');",
            "  }",
            "}"
        ], ["})()"]);
        return lines.join(' ');
    }

    function BuildFolderBridge(vol, optsJson, fresh) {
        var lines = ["(function(){"].concat(BridgeCommon(vol, optsJson, 'file:', fresh), VizLines(), [
            "var AUD = /[.](mp3|m4a|aac|mp4|m4v|ogg|oga|opus|wav|flac|webm)$/i;",
            "var MIME = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', mp4: 'audio/mp4', m4v: 'audio/mp4', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', webm: 'audio/webm' };",
            "var files = []; var idx = -1; var au = null; var fadeT = null; var skipped = 0; var viz = null;",
            "var played = [];",
            "function vizEl() { return au; }",
            "function vizHold() { return false; }",
            "function curPos() { return 0; }",
            "if (/libraryfolders[.]vdf$/i.test(location.pathname)) {",
            "  var paths = []; var ls = String(document.body ? document.body.innerText : '').split('\\n');",
            "  for (var li = 0; li < ls.length; li++) { var q = ls[li].split(String.fromCharCode(34)); if (q.length >= 5 && q[1] === 'path') paths.push(q[3].split(String.fromCharCode(92)).filter(Boolean).join('/')); }",
            "  sendSure('vdf', { paths: paths.slice(0, 20) });",
            "  return;",
            "}",
            "var probe = document.createElement('audio');",
            "function canPlay(h) { var ext = String(h).split('?')[0].split('.').pop().toLowerCase(); var m = MIME[ext]; return !m || probe.canPlayType(m) !== ''; }",
            "function scan() {",
            "  var as = document.querySelectorAll('a'); var out = []; skipped = 0;",
            "  for (var i = 0; i < as.length; i++) { var h = String(as[i].href || ''); if (!AUD.test(h.split('?')[0])) continue; if (canPlay(h)) out.push(h); else skipped++; }",
            "  return out;",
            "}",
            "var listAt = Date.now();",
            "function goTo(i, t, fresh) {",
            "  if (!files.length) return;",
            "  var j = wrap(i);",
            "  if (!fresh && Date.now() - listAt < 1800000) { load(j, true); if (t) au.currentTime = t; return; }",
            "  try { localStorage.setItem('dlm_folder_next', JSON.stringify({ name: files[j], idx: j, t: t || 0, at: Date.now() })); } catch(e) {}",
            "  location.reload();",
            "}",
            "function nameOf(h) { var f = String(h).split('/').pop(); try { f = decodeURIComponent(f); } catch(e) {} return f.replace(/[.][^.]+$/, ''); }",
            "function wrap(i) { var n = files.length; return ((i - Math.floor(i / n) * n)); }",
            "function playNow() {",
            "  if (!au) return;",
            "  if (!au.paused) return;",
            "  au.muted = true;",
            "  var pr = au.play();",
            "  if (pr && pr.then) pr.then(function() { au.muted = false; }).catch(function(e) { send('error', { msg: 'play rejected ' + e.name }); });",
            "  else au.muted = false;",
            "}",
            "function load(i, autoplay) {",
            "  if (!files.length) return;",
            "  idx = wrap(i);",
            "  if (!au) {",
            "    au = new Audio();",
            "    au.addEventListener('play', function() { send('play'); });",
            "    au.addEventListener('pause', function() { send('pause'); });",
            "    au.addEventListener('ended', function() { goNext(); });",
            "    au.addEventListener('error', function() { send('error', { msg: 'cannot play ' + nameOf(files[idx]) }); setTimeout(function() { goNext(); }, 1500); });",
            "  }",
            "  au.src = files[idx];",
            "  au.volume = Math.max(0, Math.min(1, wantVol / 100));",
            "  var nm = nameOf(files[idx]); var cut = nm.indexOf(' - ');",
            "  send('meta', { id: '', title: cut > 0 ? nm.substring(cut + 3) : nm, author: cut > 0 ? nm.substring(0, cut) : '', art: '' });",
            "  readTags(idx);",
            "  if (autoplay) playNow();",
            "}",
            "window.lkPlay = function() { if (!au) load(0, true); else playNow(); };",
            "window.lkPause = function() { if (au) au.pause(); };",
            "function nextIdx() {",
            "  if (!opts.shuffle || files.length < 2) return idx + 1;",
            "  var j = idx; for (var k = 0; k < 8 && j === idx; k++) j = Math.floor(Math.random() * files.length);",
            "  return j === idx ? idx + 1 : j;",
            "}",
            "function goNext() { if (idx >= 0) { played.push(idx); if (played.length > 100) played.shift(); } goTo(nextIdx()); }",
            "window.lkNext = function() { goNext(); };",
            "window.lkPrev = function() { if (au && au.currentTime > 3) { au.currentTime = 0; return; } if (opts.shuffle && played.length) { goTo(played.pop()); return; } goTo(idx - 1); };",
            "window.lkRefresh = function() { if (au && files.length) goTo(idx, au.currentTime || 0, true); else location.reload(); };",
            "window.lkSeek = function(sec) { if (au) au.currentTime = Math.max(0, Math.min(sec, (au.duration || sec + 3) - 3)); };",
            "window.lkSetVolume = function(v) { wantVol = v; if (au) au.volume = Math.max(0, Math.min(1, v / 100)); };",
            "window.lkFadeTo = function(to, sec) {",
            "  if (fadeT) { clearInterval(fadeT); fadeT = null; }",
            "  var from = wantVol; var ms = sec * 1000; var t0 = Date.now();",
            "  if (!(ms > 60)) { window.lkSetVolume(to); return; }",
            "  fadeT = setInterval(function() { var k = Math.min(1, (Date.now() - t0) / ms); window.lkSetVolume(from + (to - from) * k); if (k >= 1) { clearInterval(fadeT); fadeT = null; } }, 50);",
            "};",
            "window.lkSaveSettings = function(o) { opts = o || opts; saveOpts(); };",
            "var tagsSaid = false;",
            "function syncsafe(u, i) { return ((u[i] & 127) << 21) | ((u[i + 1] & 127) << 14) | ((u[i + 2] & 127) << 7) | (u[i + 3] & 127); }",
            "function be32(u, i) { return ((u[i] << 24) >>> 0) + (u[i + 1] << 16) + (u[i + 2] << 8) + u[i + 3]; }",
            "function decText(d, enc) {",
            "  var names = ['windows-1252', 'utf-16', 'utf-16be', 'utf-8'];",
            "  try { return new TextDecoder(names[enc] || 'utf-8').decode(d).replace(/[\\u0000\\ufeff]+/g, ' ').trim(); } catch(e) { return ''; }",
            "}",
            "function frameText(d) { return d.length > 1 ? decText(d.subarray(1), d[0]) : ''; }",
            "function framePic(d) {",
            "  var enc = d[0], p = 1; var mime = '';",
            "  while (p < d.length && d[p] !== 0) { mime += String.fromCharCode(d[p]); p++; }",
            "  p += 2;",
            "  if (enc === 1 || enc === 2) { while (p + 1 < d.length && !(d[p] === 0 && d[p + 1] === 0)) p += 2; p += 2; }",
            "  else { while (p < d.length && d[p] !== 0) p++; p++; }",
            "  if (p >= d.length) return null;",
            "  if (mime.indexOf('/') < 0) mime = 'image/' + (mime.toLowerCase() === 'png' ? 'png' : 'jpeg');",
            "  return { mime: mime, data: d.subarray(p) };",
            "}",
            "function parseTags(u) {",
            "  var out = {};",
            "  if (u.length < 10 || u[0] !== 73 || u[1] !== 68 || u[2] !== 51) return out;",
            "  var ver = u[3]; if (ver < 3) return out;",
            "  var end = Math.min(u.length, 10 + syncsafe(u, 6)); var pos = 10;",
            "  if (u[5] & 64) pos += ver === 4 ? syncsafe(u, 10) : be32(u, 10) + 4;",
            "  while (pos + 10 <= end) {",
            "    var id = String.fromCharCode(u[pos], u[pos + 1], u[pos + 2], u[pos + 3]);",
            "    if (!/^[A-Z0-9]{4}$/.test(id)) break;",
            "    var fs = ver === 4 ? syncsafe(u, pos + 4) : be32(u, pos + 4);",
            "    if (fs <= 0 || pos + 10 + fs > end) break;",
            "    var d = u.subarray(pos + 10, pos + 10 + fs);",
            "    if (id === 'TIT2') out.title = frameText(d);",
            "    else if (id === 'TPE1') out.artist = frameText(d);",
            "    else if (id === 'APIC' && !out.pic) out.pic = framePic(d);",
            "    pos += 10 + fs;",
            "  }",
            "  return out;",
            "}",
            "function sendCover(pic, want) {",
            "  try {",
            "    var url = URL.createObjectURL(new Blob([pic.data], { type: pic.mime }));",
            "    var im = new Image();",
            "    im.onload = function() {",
            "      try {",
            "        if (idx !== want) return;",
            "        var cv = document.createElement('canvas'); cv.width = 96; cv.height = 96;",
            "        var sz = Math.min(im.width, im.height);",
            "        cv.getContext('2d').drawImage(im, (im.width - sz) / 2, (im.height - sz) / 2, sz, sz, 0, 0, 96, 96);",
            "        send('cover', { u: cv.toDataURL('image/jpeg', 0.82) });",
            "      } catch(e) { send('tags', { how: 'cover ' + e.name }); }",
            "      URL.revokeObjectURL(url);",
            "    };",
            "    im.onerror = function() { URL.revokeObjectURL(url); };",
            "    im.src = url;",
            "  } catch(e) {}",
            "}",
            "function readTags(want) {",
            "  var f = files[want]; if (!/[.]mp3$/i.test(String(f).split('?')[0])) return;",
            "  var x = new XMLHttpRequest();",
            "  function say(how, t) { if (!tagsSaid) { tagsSaid = true; send('tags', { how: how, title: !!(t && t.title), artist: !!(t && t.artist), pic: !!(t && t.pic) }); } }",
            "  try { x.open('GET', f, true); x.responseType = 'arraybuffer'; } catch(e) { say('open ' + e.name); return; }",
            "  x.onload = function() {",
            "    if (idx !== want) return;",
            "    var t = {}; try { t = parseTags(new Uint8Array(x.response || new ArrayBuffer(0))); } catch(e) { say('parse ' + e.name); return; }",
            "    say(x.response ? 'read' : 'empty', t);",
            "    var fn = nameOf(f); var fc = fn.indexOf(' - ');",
            "    if (t.title || t.artist) send('meta', { id: '', title: t.title || (fc > 0 ? fn.substring(fc + 3) : fn), author: t.artist || (fc > 0 ? fn.substring(0, fc) : ''), fixed: true });",
            "    if (t.pic) sendCover(t.pic, want);",
            "  };",
            "  x.onerror = function() { say('blocked'); };",
            "  try { x.send(); } catch(e) { say('send ' + e.name); }",
            "}",
            "files = scan();",
            "var names = []; for (var k = 0; k < files.length && k < 5; k++) names.push(nameOf(files[k]));",
            "send('folder', { count: files.length, skipped: skipped, first: names, title: pageTitle,",
            "  formats: { mp3: probe.canPlayType('audio/mpeg'), mp4: probe.canPlayType('audio/mp4'), ogg: probe.canPlayType('audio/ogg'), wav: probe.canPlayType('audio/wav'), flac: probe.canPlayType('audio/flac'), webm: probe.canPlayType('audio/webm') } });",
            "var start = 0; var startT = 0; var resume = null;",
            "try { resume = JSON.parse(localStorage.getItem('dlm_folder_next') || 'null'); localStorage.removeItem('dlm_folder_next'); } catch(e) {}",
            "if (resume && Date.now() - resume.at < 20000) { var fi2 = files.indexOf(resume.name); start = fi2 >= 0 ? fi2 : Math.min(resume.idx || 0, Math.max(0, files.length - 1)); startT = fi2 >= 0 ? (resume.t || 0) : 0; }",
            "var mine = null; try { mine = JSON.parse(localStorage.getItem('dlm_settings') || 'null'); } catch(e) {}",
            "var resumeLast = false;",
            "if (fresh && !resume && mine && mine.rememberSong) {",
            "  var lastF = null; try { lastF = JSON.parse(localStorage.getItem('dlm_last_f') || 'null'); } catch(e) {}",
            "  var fi3 = lastF ? files.indexOf(lastF.name) : -1;",
            "  if (fi3 >= 0) { start = fi3; startT = lastF.t || 0; resumeLast = true; }",
            "}",
            "if (!resumeLast && !resume && opts.shuffle && files.length > 1) start = Math.floor(Math.random() * files.length);",
            "if (files.length) setTimeout(function() { load(start, !resumeLast); if (startT > 0) au.currentTime = startT; if (resumeLast) send('resumed', { t: Math.round(startT) }); }, 300);",
            "setInterval(function() {",
            "  n++;",
            "  if (n - Math.floor(n / 6) * 6 === 0) send('hb', { n: n });",
            "  if (au && !au.paused && au.duration) send('tick', { cur: au.currentTime || 0, dur: au.duration });",
            "  else if (au && au.paused && n - Math.floor(n / 3) * 3 === 0) send('st', { playing: false });",
            "  if (au && !au.paused && opts.rememberSong && n - Math.floor(n / 10) * 10 === 0) { try { localStorage.setItem('dlm_last_f', JSON.stringify({ name: files[idx], t: Math.floor(au.currentTime || 0) })); } catch(e) {} }",
            "}, 500);"
        ], BridgeTail(), ["})()"]);
        return lines.join(' ');
    }

    var firstBridge = true;

    function BuildBridge() {
        var o = JSON.parse(SettingsJson());
        o.zoom = ZoomValue();
        var json = JSON.stringify(o);
        if (currentSource === 'folder') return BuildFolderBridge(CurrentGain(), json, firstBridge || startup);
        return BuildYTBridge(CurrentGain(), json, firstBridge);
    }

    var metaId = '', idMismatchAt = 0, lastHealAt = 0;
    function CheckMetaId(id) {
        if (currentSource !== 'youtube' || !id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return;
        if (id === metaId) { idMismatchAt = 0; return; }
        var now = Date.now();
        if (!idMismatchAt) { idMismatchAt = now; return; }
        if (now - idMismatchAt < 2000 || now - lastHealAt < 5000) return;
        lastHealAt = now;
        DLMusic.log('Song info was stale (showing ' + (metaId || 'nothing') + ', playing ' + id + '), asking again.');
        ExecCEF('window.lkMeta && window.lkMeta()');
    }

    var artId = '', artCand = '', artCandAt = 0;
    function CheckArtId(id) {
        if (currentSource !== 'youtube' || !id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return;
        if (id === artId) { artCand = ''; return; }
        var now = Date.now();
        if (id !== artCand) { artCand = id; artCandAt = now; return; }
        if (now - artCandAt < 400) return;
        artId = id;
        artCand = '';
        SetArt('https://img.youtube.com/vi/' + id + '/mqdefault.jpg', false);
    }

    DLMusic.latestVersion = '';
    var verCheckedAt = 0, verGot = false;
    DLMusic.checkVersion = function (force) {
        if (!bridgeOk) return;
        if (!force && Date.now() - verCheckedAt < 600000) return;
        verCheckedAt = Date.now();
        ExecCEF('window.lkVer && window.lkVer()');
    };
    function VersionParts(v) { return String(v).replace(/^v/i, '').split('.').map(function (x) { return parseInt(x, 10) || 0; }); }
    function NewerThanMine(v) {
        var a = VersionParts(v), b = VersionParts(DLM_VERSION);
        for (var i = 0; i < Math.max(a.length, b.length); i++) {
            var x = a[i] || 0, y = b[i] || 0;
            if (x !== y) return x > y;
        }
        return false;
    }
    function OnLatestVersion(v) {
        var newer = NewerThanMine(v);
        DLMusic.log('Update check: latest is ' + v + (newer ? ', this is ' + DLM_VERSION + '.' : ', up to date.'));
        DLMusic.latestVersion = newer ? 'v' + String(v).replace(/^v/i, '') : '';
    }
    DLMusic.openModPage = function () { try { $.DispatchEvent('ExternalBrowserGoToURL', MOD_PAGE); } catch (e) { } };
    DLMusic.modVersion = DLM_VERSION;

    DLMusic.sendFeedback = function (f) {
        if (!Valid(cefPanel) || !bridgeOk) return false;
        var body = JSON.stringify({ name: f.name, type: f.type, msg: f.msg, v: DLM_VERSION, dev: DEV_BUILD, src: currentSource === 'folder' ? 'Music folder' : 'YouTube' });
        ExecCEF("window.lkFeedback && window.lkFeedback('" + Hex(body) + "')");
        return true;
    };

    function BridgeWatchdog() {
        if (!Valid(cefPanel)) return;
        var now = Date.now();
        if (pageSeen && now - lastBridgeMsgMs > BRIDGE_TIMEOUT_MS) {
            if (bridgeOk) DLMusic.log('Bridge went quiet, re-injecting.');
            bridgeOk = false;
            injectCount++;
            if (injectCount <= 5 || injectCount % 10 === 0) {
                DLMusic.log('Injecting ' + currentSource + ' bridge (#' + injectCount + ').');
            }
            ExecCEF(BuildBridge());
            lastBridgeMsgMs = now - BRIDGE_TIMEOUT_MS + 2500;
        }
        $.Schedule(2.0, BridgeWatchdog);
    }


    function HandleCEFMessage(raw) {
        if (!raw) return;

        if (raw.charAt(0) !== '{') {
            if (!pageSeen) DLMusic.log(currentSource + ' page loaded: ' + raw.substring(0, 80));
            pageSeen = true;
            if (currentSource === 'folder' && (raw.indexOf('Index of') === 0 || raw.indexOf('libraryfolders') >= 0)) ExecCEF(BuildBridge());
            if (currentSource === 'youtube' && Date.now() - lastQuickInject > 2000) { lastQuickInject = Date.now(); ExecCEF(BuildBridge()); }
            return;
        }

        var data;
        try { data = JSON.parse(raw); } catch (e) { return; }
        if (!data || !data.t) return;
        lastBridgeMsgMs = Date.now();
        if (data.d && data.d.q && /^[a-z0-9-]+$/.test(String(data.d.q))) {
            ExecCEF("window.lkAck && window.lkAck('" + data.d.q + "')");
            if (seenQ[data.d.q]) return;
            seenQ[data.d.q] = 1;
            if (++seenCount > 400) { seenQ = {}; seenCount = 0; }
        }

        if (data.t !== 'tick' && data.t !== 'hb' && data.t !== 'v' && data.t !== 'peer' && data.t !== 'alive' && data.t !== 'peersent' && data.t !== 'peerstate' && data.t !== 'still' && data.t !== 'cover' && data.t !== 'ver' && data.t !== 'fbsent' && data.t !== 'vdf' && data.t !== 'resumed' && data.t !== 'vizstat' && data.t !== 'st') {
            DLMusic.log(currentSource + ': ' + JSON.stringify(data).substring(0, 200));
        }

        switch (data.t) {
            case 'bridge':
                bridgeOk = true;
                injectCount = 0;
                if (lightPage && data.d && data.d.href && String(data.d.href).indexOf('robots.txt') < 0) lightPage = false;
                if (data.d && data.d.saved) ApplySavedSettings(data.d.saved);
                ExecCEF('window.lkSetVolume(' + CurrentGain() + ')');
                ExecCEF('window.lkSaveSettings(' + SettingsJson() + ')');
                if (pendingPlayId && currentSource === 'youtube') { ExecCEF("window.lkPlayId('" + pendingPlayId + "', " + PeerStartAt(pendingPeer) + ")"); pendingPlayId = null; pendingPeer = null; }
                sentLk = '';
                zoomSent = '';
                SendZoom();
                firstBridge = false;
                if (!verGot) DLMusic.checkVersion(true);
                break;
            case 'alive':
                bridgeOk = true;
                break;
            case 'still':
                DLMusic.log('YouTube asked "Continue watching?", said yes.');
                break;
            case 'viz':
                if (data.d && data.d.ok === true) vizLive = true;
                if (data.d && data.d.ok === false) vizLive = false;
                break;
            case 'vizstat':
                if (data.d) OnVizStat(data.d);
                break;
            case 'vdf':
                OnVdf(data.d && data.d.paths);
                break;
            case 'cover':
                if (currentSource === 'folder' && data.d && /^data:image[/]jpeg;base64,[A-Za-z0-9+/=]+$/.test(String(data.d.u || ''))) {
                    SetArt(data.d.u, true);
                    DLMusic.log('Folder: album art from the file (' + data.d.u.length + ' chars).');
                }
                break;
            case 'ver':
                verGot = true;
                if (data.d && data.d.v) OnLatestVersion(String(data.d.v));
                if (data.d && data.d.notes && DLMusic.onNotes) DLMusic.onNotes(data.d.notes);
                break;
            case 'fbsent':
                DLMusic.log(data.d && data.d.ok ? 'Feedback sent.' : "Feedback couldn't be sent.");
                if (DLMusic.onFeedbackSent) DLMusic.onFeedbackSent(!!(data.d && data.d.ok));
                break;
            case 'resumed':
                DLMusic.log('Picked up the last song (paused at ' + (data.d ? data.d.t : 0) + 's).');
                break;
            case 'peer':
                if (data.d) OnPeer(data.d);
                break;
            case 'peerstate':
                if (data.d && !data.d.on) ClearPeers();
                if (data.d && data.d.on) DLMusic.log('Sharing: connected (room ' + data.d.room + ').');
                break;
            case 'peersent':
                DLMusic.log(data.d && data.d.off ? 'Sharing: told the room I stopped sharing.' : 'Sharing: sent my song.');
                break;
            case 'meta':
                if (data.d && data.d.fixed) {
                    if (data.d.title && data.d.title !== np.title) SetTitle(data.d.title);
                    SetArtist(CleanArtist(data.d.author));
                    break;
                }
                if (data.d) {
                    metaId = data.d.id || '';
                    idMismatchAt = 0;
                    SetTitle(data.d.title || 'Unknown');
                    SetArtist(CleanArtist(data.d.author));
                    shareCode = (currentSource === 'youtube' && data.d.id) ? 'y:' + data.d.id : '';
                    if (data.d.art) SetArt(data.d.art, true);
                    else if (data.d.id) { if (data.d.id !== artId) SetArt('https://img.youtube.com/vi/' + data.d.id + '/mqdefault.jpg', false); artId = data.d.id; }
                    else SetArt('');
                    SetProgress(0);
                    prog.cur = 0;
                    prog.at = Date.now();
                    sheenNext = Date.now() + 1200;
                }
                break;
            case 'play':
                SetPlaying(true);
                break;
            case 'pause':
                SetPlaying(false);
                break;
            case 'st':
                SyncPlaying(!!(data.d && data.d.playing));
                break;
            case 'tick':
                SyncPlaying(true);
                CheckMetaId(data.d.id);
                CheckArtId(data.d.u || data.d.id);
                currentDuration = data.d.dur || 0;
                OnTick(data.d.cur || 0, currentDuration);
                if (!isPlaying || !prog.at) SetProgress(currentDuration > 0 ? Math.min(100, (prog.cur / currentDuration) * 100) : 0);
                break;
            case 'v':
                OnVizLevels(data.d && data.d.b);
                break;
            case 'folder':
                if (data.d) FolderPage(data.d);
                break;
        }
    }

    var POLL_SEC = 0.1;
    var curGain = null;
    var lastSentArg = null;
    var lastSentAt = 0;
    var lastVolState = null;
    var alertPanel = null;
    var damageMeter = null;
    var sawOutOfCombat = false;
    var lastSignal = null;
    var fastFade = false;
    var lastTabMute = false;
    DLMusic.combatDebug = 'not polled yet';

    function AncestorHasClass(p, cls, maxUp) {
        for (var i = 0; p && i < maxUp; i++) {
            if (p.BHasClass && p.BHasClass(cls)) return true;
            p = p.GetParent ? p.GetParent() : null;
        }
        return false;
    }

    function DetectCombat(r) {
        if (!r || !r.FindChildTraverse) return false;
        if (!Valid(alertPanel)) alertPanel = r.FindChildTraverse('InCombatAlert');
        if (!Valid(damageMeter)) damageMeter = r.FindChildTraverse('damage_meter');

        var shop = Valid(alertPanel) ? AncestorHasClass(alertPanel, 'inCombat', 12) : false;
        var outOf = Valid(damageMeter) ? AncestorHasClass(damageMeter, 'out_of_combat', 20) : false;
        if (outOf) sawOutOfCombat = true;
        var hud = Valid(damageMeter) && sawOutOfCombat && !outOf;

        DLMusic.combatDebug =
            'shop.inCombat=' + (Valid(alertPanel) ? (shop ? 'YES' : 'no') : 'n/a') +
            '  hud.out_of_combat=' + (Valid(damageMeter) ? (outOf ? 'yes' : (sawOutOfCombat ? 'NO' : 'never seen')) : 'n/a');

        return shop || hud;
    }

    function CurrentGain() {
        if (curGain === null) return S.normalVol;
        return Math.round(curGain);
    }

    function PollCombat() {
        var nowMs = Date.now();
        var signal = DetectCombat(FindRoot());
        if (signal) lastCombatMs = nowMs;
        if (signal !== lastSignal) {
            lastSignal = signal;
            DLMusic.log('Combat signal: ' + (signal ? 'IN COMBAT' : 'out of combat'));
        }

        var holding = lastCombatMs > 0 && (nowMs - lastCombatMs) <= S.holdSec * 1000;
        var ducked = S.duckEnabled && (signal || holding);
        DLMusic.isDucked = ducked;

        var target = ducked ? S.combatVol : S.normalVol;
        if (DLMusic.quiet) target = S.quietVol;
        var tabMute = DLMusic.tabbedOut && S.tabMode === 'mute';
        if (tabMute) target = 0;
        if (tabMute !== lastTabMute) { lastTabMute = tabMute; fastFade = true; }

        var state = tabMute ? 'tab' : (DLMusic.quiet ? 'quiet' : (ducked ? 'combat' : 'normal'));
        var arg = target;
        var stateChanged = state !== lastVolState;
        if (arg !== lastSentArg && (stateChanged || nowMs - lastSentAt >= 150)) {
            var sec = 0.15;
            if (stateChanged && curGain !== null) {
                if (state === 'combat' || lastVolState === 'combat') sec = target < curGain ? S.fadeOutSec : S.fadeInSec;
                else sec = 0.3;
            }
            lastSentArg = arg;
            lastSentAt = nowMs;
            lastVolState = state;
            curGain = target;
            ExecCEF('window.lkFadeTo && window.lkFadeTo(' + arg + ', ' + sec + ')');
        } else if (arg === lastSentArg) {
            lastVolState = state;
        }
        DLMusic.currentVolume = target;
        $.Schedule(POLL_SEC, PollCombat);
    }

    var TAB_WIN_MS = 500;
    var tabLast = 0, tabSum = 0, tabMax = 0, tabCount = 0, tabWinEnd = 0, tabSteady = 0;
    var pausedByTab = false;
    DLMusic.tabbedOut = false;

    function SetTabbedOut(on, why) {
        if (DLMusic.tabbedOut === on) return;
        DLMusic.tabbedOut = on;
        DLMusic.log(on ? ('Tabbed out (' + why + ').') : ('Back in game (' + why + ').'));
        var pauseIt = S.tabMode === 'pause';
        if (on && pauseIt && isPlaying) {
            pausedByTab = true;
            ExecCEF('window.lkPause()');
        } else if (!on && pausedByTab) {
            pausedByTab = false;
            ExecCEF('window.lkPlay()');
        }
    }

    function TabFrame() {
        var now = Date.now();
        if (tabLast) {
            var dt = now - tabLast;
            tabSum += dt; tabCount++;
            if (dt > tabMax) tabMax = dt;
        }
        tabLast = now;
        if (now >= tabWinEnd) {
            if (tabCount > 3) {
                var avg = tabSum / tabCount;
                var steady = avg >= 22 && avg <= 32 && (tabMax - avg) < 6;
                if (steady) {
                    tabSteady++;
                    if (tabSteady >= 3) SetTabbedOut(true, 'steady ' + avg.toFixed(1) + 'ms frames');
                } else {
                    tabSteady = 0;
                    if (avg < 20) SetTabbedOut(false, avg.toFixed(1) + 'ms frames');
                }
            }
            tabSum = 0; tabMax = 0; tabCount = 0;
            tabWinEnd = now + TAB_WIN_MS;
        }
        $.Schedule(0.0, TabFrame);
    }

    var HUD_HIDE_CLASSES = ['gShopOpen', 'gDetailView', 'gItemDraftOpen'];
    var abilitiesBox = null;
    var escMenuPanel = null;
    var escClassSeen = false;

    function EscMenuOpen() {
        var r = FindRoot();
        if (!Valid(escMenuPanel) && r && r.FindChildTraverse) escMenuPanel = r.FindChildTraverse('EscapeMenu');
        var p = Valid(escMenuPanel) ? escMenuPanel : r;
        for (var i = 0; p && i < 16; i++) {
            if (p.BHasClass && p.BHasClass('ShowEscapeMenu')) {
                if (!escClassSeen) { escClassSeen = true; DLMusic.log('Pause menu signal found (ShowEscapeMenu on ' + (p.id || '?') + ').'); }
                return true;
            }
            p = p.GetParent ? p.GetParent() : null;
        }
        return false;
    }
    DLMusic.escMenuOpen = EscMenuOpen;
    DLMusic.escClassSeen = function () { return escClassSeen; };
    var aliveBox = null;
    var hudHidden = null;

    function HudVisibilityTick() {
        var r = FindRoot();
        if (r && r.FindChildTraverse) {
            if (!Valid(abilitiesBox)) abilitiesBox = r.FindChildTraverse('AbilitiesContainer');
            if (!Valid(aliveBox)) aliveBox = r.FindChildTraverse('gameplay_hud_alive');
        }
        var why = '';
        var tabHeld = false;
        if (Valid(abilitiesBox)) {
            tabHeld = abilitiesBox.BHasClass('gScoreboardOpen');
            if (!tabHeld && DLMusic.tabHeldNow) CancelHudDrag();
            DLMusic.tabHeldNow = tabHeld;
            if (!tabHeld) {
                for (var i = 0; i < HUD_HIDE_CLASSES.length; i++) {
                    if (abilitiesBox.BHasClass(HUD_HIDE_CLASSES[i])) { why = HUD_HIDE_CLASSES[i]; break; }
                }
            }
        }
        if (!why && Valid(aliveBox) && aliveBox.visible === false) why = 'dead';
        if (!why && EscMenuOpen()) why = 'pause menu';
        if (!why && !S.showHud) why = 'turned off';
        var hide = !!why;
        if (hide !== hudHidden && Valid(panel)) {
            hudHidden = hide;
            panel.SetHasClass('DLMHudHidden', hide);
            DLMusic.log('HUD player ' + (hide ? 'hidden (' + why + ')' : 'shown') + '.');
        }
        $.Schedule(0.1, HudVisibilityTick);
    }

    function FindAll(start, test, max, limit) {
        var out = [], st = [start], seen = 0;
        while (st.length && out.length < max && seen < (limit || 20000)) {
            var p = st.pop();
            seen++;
            if (!p) continue;
            if (test(p)) out.push(p);
            var n = p.GetChildCount ? p.GetChildCount() : 0;
            for (var j = 0; j < n; j++) st.push(p.GetChild(j));
        }
        return out;
    }

    function LabelsInOrder(p, max) {
        var out = [], st = [p], seen = 0;
        while (st.length && out.length < max && seen < 800) {
            var q = st.pop();
            seen++;
            if (q.paneltype === 'Label') out.push(q);
            var n = q.GetChildCount ? q.GetChildCount() : 0;
            for (var k = n - 1; k >= 0; k--) st.push(q.GetChild(k));
        }
        return out;
    }

    DLMusic.peers = {};
    var pendingPlayId = null;
    var peerLayer = null, peerCards = {};
    var topBar = null, peerBars = [], peerBarsAt = 0, colsCache = [], colsAt = 0;
    var me = { acc: '', name: '', hero: '', shown: '', logged: '', lookedAt: 0 };
    var room = { src: '', since: 0, used: '' };
    var share = { key: '', since: 0, note: '' };
    var sentLk = '';
    var shareCode = '';

    function PeerBars() {
        var now = Date.now();
        if (now - peerBarsAt > 5000 || (peerBars.length && !Valid(peerBars[0]))) {
            peerBarsAt = now;
            var r = FindRoot();
            if (!Valid(topBar) && r) topBar = r.FindChildTraverse('TopBar');
            peerBars = Valid(topBar) ? FindAll(topBar, function (p) { return p.paneltype === 'CitadelHudTopBarPlayer'; }, 14, 6000) : [];
        }
        return peerBars;
    }

    function Norm(t) { return String(t || '').trim().toLowerCase(); }

    function Columns() {
        var now = Date.now();
        if (now - colsAt < 1000) return colsCache;
        colsAt = now;
        var bars = PeerBars(), out = [];
        for (var i = 0; i < bars.length; i++) {
            var b = bars[i];
            if (!Valid(b)) continue;
            var box = b.FindChildTraverse('PlayerNameNWContainer');
            var ls = box ? LabelsInOrder(box, 2) : [];
            out.push({ bar: b, name: ls[0] ? String(ls[0].text || '').trim() : '', hero: ls[1] ? String(ls[1].text || '').trim() : '' });
        }
        colsCache = out;
        return out;
    }

    function Loose(t) { return Norm(t).replace(/[^a-z0-9]/g, ''); }

    function MatchColumn(cols, n, h) {
        var i, hits = [];
        if (h) {
            for (i = 0; i < cols.length; i++) if (Norm(cols[i].hero) === Norm(h)) hits.push(cols[i]);
            if (hits.length === 1) return hits[0];
        }
        return NameColumn(cols, n);
    }

    function NameColumn(cols, n) {
        if (!n) return null;
        var i, hits = [];
        for (i = 0; i < cols.length; i++) if (Norm(cols[i].name) === Norm(n)) hits.push(cols[i]);
        if (hits.length === 1) return hits[0];
        hits = [];
        for (i = 0; i < cols.length; i++) if (Loose(cols[i].name) && Loose(cols[i].name) === Loose(n)) hits.push(cols[i]);
        return hits.length === 1 ? hits[0] : null;
    }

    function FindMe() {
        var now = Date.now();
        if (me.name || now - me.lookedAt < 30000) return;
        me.lookedAt = now;
        var r = FindRoot();
        if (!r) return;
        var lp = r.FindChildTraverse('LocalPlayer');
        if (lp) {
            var av = FindAll(lp, function (p) { return p.paneltype === 'CitadelAvatarImage'; }, 1, 300);
            if (av.length) me.acc = String(av[0].accountid || '');
        }
        if (me.acc && me.acc !== '0') {
            var un = FindAll(r, function (p) {
                if (p.paneltype !== 'CitadelUserName') return false;
                var a = null;
                try { a = p.accountid; } catch (e) { a = null; }
                return String(a) === me.acc;
            }, 1, 60000);
            if (un.length) {
                var t = String(un[0].text || '');
                if (!t) { var ls = LabelsInOrder(un[0], 1); if (ls.length) t = String(ls[0].text || ''); }
                me.name = t.trim();
            }
        }
        DLMusic.log('Sharing: own name ' + (me.name ? 'found' : 'not found yet') + '.');
    }

    function Hex(t) {
        t = String(t || '');
        var out = [];
        for (var i = 0; i < t.length; i++) out.push(t.charCodeAt(i).toString(16));
        return out.join('-');
    }

    function ClearPeers() {
        DLMusic.peers = {};
        for (var k in peerCards) if (Valid(peerCards[k].box)) peerCards[k].box.style.visibility = 'collapse';
    }

    function PeerSyncTick() {
        var now = Date.now();
        var on = !!S.shareSongs;
        var cols = on ? Columns() : [];
        var src = '';
        if (cols.length >= 2) {
            var names = [];
            for (var i = 0; i < cols.length; i++) if (cols[i].name) names.push(Norm(cols[i].name));
            if (names.length === cols.length) { names.sort(); src = names.join('\n'); }
        }
        if (src !== room.src) { room.src = src; room.since = now; }
        var target = !room.src ? '' : ((room.src === room.used || now - room.since >= 45000) ? room.src : room.used);
        if (target !== room.used) {
            room.used = target;
            ClearPeers();
            DLMusic.log(target ? 'Sharing: joined the match room (' + cols.length + ' players).' : 'Sharing: left the match room.');
        }

        var note = '';
        if (target && S.shareSongs) {
            FindMe();
            if (me.name) {
                var mine = NameColumn(cols, me.name);
                if (mine) { me.hero = mine.hero; me.shown = mine.name; }
                var who = (mine ? mine.name : me.name) + '|' + me.hero;
                if (who !== me.logged) {
                    me.logged = who;
                    if (mine) DLMusic.log('Sharing: sharing as ' + mine.hero + ' (' + mine.name + ').');
                    else {
                        var list = [];
                        for (var q = 0; q < cols.length; q++) list.push(cols[q].name);
                        DLMusic.log("Sharing: couldn't find my own column (my name: " + me.name + '; columns: ' + list.join(', ') + ').');
                    }
                }
                var key = shareCode + '|' + np.title + '|' + S.artBorder + S.borderStyle;
                if (key !== share.key) { share.key = key; share.since = now; }
                if (np.title && now - share.since >= 10000) {
                    share.note = JSON.stringify({ h: me.hero.substring(0, 40), n: (me.shown || me.name).substring(0, 40), c: shareCode, t: np.title.substring(0, 60), b: S.artBorder ? S.borderStyle : 'off' });
                }
                note = share.note;
            }
        } else {
            share.note = '';
            share.key = '';
        }

        var lk = Hex(target) + "', '" + Hex(note) + "', " + (S.shareSongs ? 'true' : 'false');
        if (lk !== sentLk && bridgeOk) {
            sentLk = lk;
            ExecCEF("window.lkPeer && window.lkPeer('" + lk + ")");
        }
        $.Schedule(1.0, PeerSyncTick);
    }

    function OnPeer(d) {
        var key = d.h ? 'h:' + Norm(d.h) : 'n:' + Norm(d.n);
        var col = MatchColumn(Columns(), d.n, d.h);
        DLMusic.log('Sharing: ' + (d.off ? 'a player stopped sharing' : 'received a song') + ' from ' + (d.h || '?') + ' (' + (d.n || '?') + ')' + (col ? '' : ', no matching player on the scoreboard') + '.');
        if (d.off || (!d.id && !d.t)) { delete DLMusic.peers[key]; return; }
        DLMusic.peers[key] = { n: d.n, h: d.h, id: d.id, t: d.t, b: d.b || '', p: typeof d.p === 'number' ? d.p : -1, at: Date.now() - (d.age || 0) };
    }

    var BORDER_INLINE = {
        gold: 'gradient( linear, 0% 0%, 100% 100%, from( #f3e9d6 ), color-stop( 0.5, #b89a6e ), to( #5e4a32 ) )',
        silver: 'gradient( linear, 0% 0%, 100% 100%, from( #f6f8fa ), color-stop( 0.5, #a3acb6 ), to( #474d55 ) )',
        dark: '#141312',
        neon: 'gradient( linear, 0% 0%, 100% 100%, from( #45efff ), color-stop( 0.5, #b44cff ), to( #ff4fa3 ) )',
        glass: '#ffffff24'
    };

    function StyleCardBorder(c, pr) {
        var st = pr && pr.b ? pr.b : 'gold';
        if (c.border === st) return;
        c.border = st;
        var f = c.frame.style;
        f.backgroundColor = st === 'off' ? 'transparent' : (BORDER_INLINE[st] || BORDER_INLINE.gold);
        f.border = (st === 'dark' || st === 'glass') ? '1px solid ' + (st === 'dark' ? '#ffffff2e' : '#ffffff5c') : '0px solid transparent';
        f.boxShadow = st === 'neon' ? '0px 0px 10px #b44cffb0' : '0px 3px 8px #000000c0';
    }

    function PeerCard(key) {
        if (peerCards[key] && Valid(peerCards[key].box)) return peerCards[key];
        if (!Valid(peerLayer)) {
            var top = FindRoot();
            if (!top) return null;
            peerLayer = $.CreatePanel('Panel', top, 'DLMPeerLayer');
            peerLayer.style.width = '100%';
            peerLayer.style.height = '100%';
            peerLayer.style.zIndex = '9999';
            peerLayer.hittest = false;
            peerLayer.hittestchildren = true;
        }
        var box = $.CreatePanel('Button', peerLayer, '');
        box.style.width = '84px';
        box.style.flowChildren = 'down';
        box.style.backgroundColor = 'transparent';
        box.style.border = '0px solid transparent';

        var frame = $.CreatePanel('Panel', box, '');
        frame.style.width = '78px';
        frame.style.height = '78px';
        frame.style.padding = '3px';
        frame.style.horizontalAlign = 'center';
        frame.style.borderRadius = '7px';
        frame.hittest = false;
        var clip = $.CreatePanel('Panel', frame, '');
        clip.style.width = '72px';
        clip.style.height = '72px';
        clip.style.overflow = 'clip';
        clip.style.borderRadius = '5px';
        clip.style.backgroundColor = '#000000';
        clip.hittest = false;
        var img = $.CreatePanel('Image', clip, '');
        img.hittest = false;

        var tclip = $.CreatePanel('Panel', box, '');
        tclip.style.width = '84px';
        tclip.style.height = '16px';
        tclip.style.marginTop = '4px';
        tclip.style.overflow = 'clip';
        tclip.hittest = false;
        var strip = $.CreatePanel('Panel', tclip, '');
        strip.style.width = '3000px';
        strip.style.height = '16px';
        strip.style.flowChildren = 'right';
        strip.hittest = false;
        var label = $.CreatePanel('Label', strip, '');
        label.style.color = '#ffffff';
        label.style.fontSize = '12px';
        label.style.fontWeight = 'bold';
        label.style.textShadow = '0px 1px 3px #000000';
        label.style.whiteSpace = 'nowrap';
        label.hittest = false;

        box.SetPanelEvent('onactivate', function () {
            var pr = DLMusic.peers[key];
            if (pr && pr.id) PlayPeer(pr.id, pr);
        });
        box.style.visibility = 'collapse';
        peerCards[key] = { box: box, frame: frame, img: img, label: label, shown: '', border: '',
            titleLabel: label, titleClip: tclip, marqOffset: 0, marqAtEnd: false, marqPauseUntil: 0, centerShort: true, onScreen: false };
        StyleCardBorder(peerCards[key], DLMusic.peers[key]);
        return peerCards[key];
    }

    function PeerMarquees() {
        var out = [];
        for (var k in peerCards) if (peerCards[k].onScreen && Valid(peerCards[k].box)) out.push(peerCards[k]);
        return out;
    }

    function SetCardImage(c, id) {
        var st = c.img.style;
        if (id) {
            c.img.SetImage('https://img.youtube.com/vi/' + id + '/mqdefault.jpg');
            st.width = '128px';
            st.height = '72px';
            st.marginLeft = '-28px';
            st.marginTop = '0px';
            st.opacity = '1';
        } else {
            c.img.SetImage(ICON_EMPTY);
            st.width = '34px';
            st.height = '34px';
            st.marginLeft = '19px';
            st.marginTop = '19px';
            st.opacity = '0.7';
        }
    }

    function PeerStartAt(pr) {
        if (!pr || !(pr.p >= 0) || !pr.at) return 0;
        return Math.max(0, Math.round(pr.p + (Date.now() - pr.at) / 1000));
    }
    var pendingPeer = null;

    function PlayPeer(id, pr) {
        var at = PeerStartAt(pr);
        DLMusic.log('Playing a song from the scoreboard (y:' + id + (at ? ', from ' + at + 's' : '') + ').');
        SetTitle(pr && pr.t ? pr.t : '');
        SetArtist('');
        SetArt('https://img.youtube.com/vi/' + id + '/mqdefault.jpg', false);
        artId = id;
        SetProgress(0);
        if (currentSource === 'youtube' && bridgeOk) {
            ExecCEF("window.lkPlayId('" + id + "', " + at + ")");
            return;
        }
        pendingPlayId = id;
        pendingPeer = pr;
        S.source = 'youtube';
        if (DLMusic.settingsChanged) DLMusic.settingsChanged();
    }

    function PeerTick() {
        var show = !!(DLMusic.tabHeldNow && S.shareSongs && room.used);
        var cols = show ? Columns() : [];
        var seen = {};
        if (show) {
            for (var key in DLMusic.peers) {
                var pr = DLMusic.peers[key];
                var col = MatchColumn(cols, pr.n, pr.h);
                var c = PeerCard(key);
                if (!c) continue;
                seen[key] = 1;
                var anchor = col ? (col.bar.FindChildTraverse('PlayerNameNWContainer') || col.bar) : null;
                if (!anchor || !col.bar.visible || !(anchor.actuallayoutheight > 0)) { c.box.style.visibility = 'collapse'; c.onScreen = false; continue; }
                StyleCardBorder(c, pr);
                var look = pr.id + '|' + pr.t;
                if (c.shown !== look) {
                    c.shown = look;
                    SetCardImage(c, pr.id);
                    c.label.text = pr.t || '';
                    c.marqOffset = 0;
                    c.marqAtEnd = false;
                    c.marqPauseUntil = Date.now() + MARQ_START_PAUSE;
                }
                var pos = anchor.GetPositionWithinWindow();
                var sc = peerLayer.actualuiscale_x || anchor.actualuiscale_x || 1;
                var x = Math.round((pos.x + anchor.actuallayoutwidth / 2) / sc - 42);
                var y = Math.round((pos.y + anchor.actuallayoutheight) / sc + 6);
                c.box.style.position = x + 'px ' + y + 'px 0px';
                c.box.style.visibility = 'visible';
                c.onScreen = true;
            }
        }
        for (var k in peerCards) if (!seen[k] && Valid(peerCards[k].box)) { peerCards[k].box.style.visibility = 'collapse'; peerCards[k].onScreen = false; }
        $.Schedule(0.1, PeerTick);
    }

    var qb = { panel: null, souls: null, elems: [], foundAt: 0, logged: false, moved: false, said: false };
    var qbStart = Date.now();
    function QueueTick() {
        var r = FindRoot();
        var now = Date.now();
        if (r && (now - qb.foundAt > 3000 || !Valid(qb.panel))) {
            qb.foundAt = now;
            qb.panel = r.FindChildTraverse('CitadelHudQuickbuy');
            qb.souls = r.FindChildTraverse('gold_and_ap_container');
            qb.low = r.FindChildTraverse('LowerLeft');
            var mods = Valid(qb.low) ? FindAll(qb.low, function (p) { return p.BHasClass && p.BHasClass('ModsContainer'); }, 1, 200) : [];
            qb.mods = mods.length ? mods[0] : null;
            qb.elems = Valid(qb.panel) ? FindAll(qb.panel, function (p) { return p.BHasClass && p.BHasClass('HudQuickbuyElement'); }, 4, 400) : [];
        }
        var shop = Valid(abilitiesBox) && (abilitiesBox.BHasClass('gShopOpen') || abilitiesBox.BHasClass('gEditingBuilds'));
        if (!qb.said && now - qbStart > 20000) {
            qb.said = true;
            if (!qb.logged) DLMusic.log('Item queue: not moved yet (quick buy ' + (Valid(qb.panel) ? 'found' : 'missing') + ', souls ' + (Valid(qb.souls) ? 'found' : 'missing') + ', lower left ' + (Valid(qb.low) ? 'found' : 'missing') + ', item slots ' + (Valid(qb.mods) ? 'found' : 'missing') + ', ' + qb.elems.length + ' queue icon(s)).');
        }
        if (Valid(qb.panel) && Valid(qb.souls) && qb.elems.length) {
            for (var i = 0; i < qb.elems.length; i++) {
                var el = qb.elems[i];
                if (!Valid(el)) continue;
                if (shop) {
                    if (qb.moved) { try { el.style.marginLeft = '0px'; el.style.marginBottom = '0px'; el.style.marginTop = '0px'; } catch (e) {} }
                    continue;
                }
                var par = el.GetParent();
                if (!par) continue;
                var sc = el.actualuiscale_x || 1;
                var right = SoulsRight(qb.souls, qb.low, qb.panel);
                if (right === null) continue;
                var sp = qb.souls.GetPositionWithinWindow();
                var pp = par.GetPositionWithinWindow();
                var mini = el.FindChildTraverse('HudMini');
                var h = (mini && mini.actuallayoutheight > 0 ? mini.actuallayoutheight : el.actuallayoutheight) / sc;
                if (!(h > 10)) h = 70;
                var x = Math.round((right - pp.x) / sc + 16);
                var bottom = Valid(qb.mods) ? (qb.mods.GetPositionWithinWindow().y - pp.y) / sc - 8 : (sp.y - pp.y) / sc + qb.souls.actuallayoutheight / sc;
                var y = Math.round(bottom - h);
                el.style.transformOrigin = null;
                el.style.preTransformScale2d = null;
                el.style.verticalAlign = 'top';
                el.style.marginTop = y + 'px';
                el.style.marginBottom = '0px';
                el.style.marginLeft = x + 'px';
                if (!qb.logged) { qb.logged = true; DevLog('Item queue: moved next to the souls (x ' + x + ', y ' + y + ', icon ' + Math.round(h) + 'px).'); }
            }
            qb.moved = !shop;
        }
        $.Schedule(0.25, QueueTick);
    }

    function SoulsRight(box, low, skip) {
        var sp = box.GetPositionWithinWindow();
        var top = sp.y, bot = sp.y + box.actuallayoutheight;
        var isLabel = function (p) { return p.paneltype === 'Label'; };
        var ls = FindAll(box, isLabel, 30, 600);
        if (Valid(low)) ls = ls.concat(FindAll(low, isLabel, 600, 8000));
        var best = null, seen = [];
        for (var i = 0; i < ls.length; i++) {
            var l = ls[i];
            if (!l.visible || !(l.actuallayoutwidth > 0) || !String(l.text || '').trim()) continue;
            if (Valid(skip) && InsidePanel(l, skip)) continue;
            var pos = l.GetPositionWithinWindow();
            var mid = pos.y + l.actuallayoutheight / 2;
            if (mid < top || mid > bot) continue;
            var r = pos.x + l.actuallayoutwidth;
            if (!qb.logged) seen.push(String(l.text).trim().substring(0, 12) + '@' + Math.round(r));
            if (best === null || r > best) best = r;
        }
        if (!qb.logged && seen.length) DevLog('Item queue: souls row text ' + seen.join(', ') + '.');
        if (best === null && box.actuallayoutwidth > 0) best = sp.x + box.actuallayoutwidth;
        return best;
    }

    function InsidePanel(p, outer) {
        for (var i = 0; p && i < 40; i++) {
            if (p === outer) return true;
            p = p.GetParent ? p.GetParent() : null;
        }
        return false;
    }

    function Init() {
        if (!EnsurePanel()) {
            $.Schedule(1.0, Init);
            return;
        }
        PollCombat();
        $.Schedule(3.0, function () { EnsureCEFPanel(true); });
        MarqueeTick();
        PeerTick();
        PeerSyncTick();
        TabFrame();
        SheenTick();
        VizTick();
        HudVisibilityTick();
        QueueTick();
        ProgressTick();
    }

    DLMusic.ensureCEFPanel = EnsureCEFPanel;
    DLMusic.setBrowserVisible = SetBrowserVisible;
    DLMusic.currentSourceName = function () { return currentSource; };

    $.Schedule(1.0, Init);
})();

(function () {
    'use strict';

    var DLMusic = (globalThis.DLMusic = globalThis.DLMusic || {});
    DLMusic.logBuffer = DLMusic.logBuffer || [];

    function DevLog(msg) { if (DLMusic.dev) DLMusic.log(msg); }

    var overlay = null;
    var card = null;
    var mainTitle = null;
    var mainScroll = null;
    var tabs = {};
    var tabOrder = [];
    var activeTab = '';
    var valueEntries = [];
    var toggles = [];
    var choices = [];
    var escBtn = null;
    var isOpen = false;
    var clickGuardAt = 0;
    var previewBuilt = false;
    var openedAt = 0;
    var folderBox = null, folderName = null;
    var reloadBtn = null, zoomBtn = null, updateLink = null;
    var textEntries = [];
    var fb = { name: null, msg: null, count: null, send: null, status: null, type: 'Bug', typePills: [] };

    function Settings() { return DLMusic.settings || {}; }
    function Changed() {
        RefreshValues();
        if (DLMusic.settingsChanged) DLMusic.settingsChanged();
    }
    function Guard() { clickGuardAt = Date.now(); }

    function topRoot() {
        var root = $.GetContextPanel();
        for (var i = 0; i < 40 && root && root.GetParent && root.GetParent(); i++) {
            root = root.GetParent();
        }
        return root;
    }

    function findAnchor() {
        var root = topRoot();
        if (!root || !root.FindChildTraverse) return null;
        return root.FindChildTraverse('SubOptions') || root.FindChildTraverse('Menu');
    }

    function findMenuButton(re) {
        var root = topRoot();
        if (!root || !root.FindChildTraverse) return null;
        var start = root.FindChildTraverse('EscapeMenu') || root;
        var stack = [start], seen = 0;
        while (stack.length && seen < 5000) {
            var p = stack.pop();
            seen++;
            if (!p) continue;
            var type = p.paneltype;
            if ((type === 'Label' || type === 'TextButton') && re.test(String(p.text || ''))) {
                var b = p;
                for (var i = 0; i < 4 && b; i++) {
                    if (b.paneltype === 'Button' || b.paneltype === 'TextButton') return b;
                    b = b.GetParent();
                }
                return p.GetParent();
            }
            var n = p.GetChildCount ? p.GetChildCount() : 0;
            for (var j = 0; j < n; j++) stack.push(p.GetChild(j));
        }
        return null;
    }

    function findFeedbackButton() { return findMenuButton(/feedback/i); }

    function CreateEscButton(parent) {
        var btn = $.CreatePanel('Button', parent, 'DLMusicSettingsBtn');
        btn.AddClass('nav_menu_item');
        btn.AddClass('minor');
        var lbl = $.CreatePanel('Label', btn, '');
        lbl.AddClass('menuButtonLabel');
        lbl.text = 'DEADLOCK RADIO';
        btn.SetPanelEvent('onactivate', function () { Toggle(); });
        return btn;
    }

    var placedAboveFeedback = false;
    var escSpaced = false;
    var escTarget = null;

    function SpaceEscButton() {
        if (escSpaced || !(escBtn && escBtn.IsValid && escBtn.IsValid()) || !(escTarget && escTarget.IsValid())) return;
        var sc = escBtn.actualuiscale_y || 1;
        var h = escBtn.actuallayoutheight / sc;
        if (!(h > 0)) return;
        escSpaced = true;
        var gap = (escTarget.actualyoffset - escBtn.actualyoffset - escBtn.actuallayoutheight) / sc;
        if (gap > 2) {
            escTarget.style.marginTop = '0px';
            escBtn.style.marginTop = Math.round(gap) + 'px';
            $.Schedule(0.2, function () {
                if (!escBtn.IsValid() || !escTarget.IsValid()) return;
                var g2 = (escTarget.actualyoffset - escBtn.actualyoffset - escBtn.actuallayoutheight) / sc;
                if (g2 > 2) { escBtn.style.marginTop = '0px'; DLMusic.log('Pause menu: the gap above Player Feedback stayed (' + Math.round(g2) + 'px).'); }
            });
        }
        DevLog('Pause menu: gap ' + Math.round(gap) + 'px.');
        PlaceSwap(0.2);
        PlaceSwap(1.5);
        PlaceSwap(4.0);
    }

    var swapLogged = '', swapMissSaid = false;

    function FindSwap() {
        var root = topRoot();
        var menu = root && root.FindChildTraverse ? (root.FindChildTraverse('EscapeMenu') || root) : null;
        var swap = menu ? menu.FindChildTraverse('changehero') : null;
        if (!swap) swap = findMenuButton(/swap/i);
        if (!swap && !swapMissSaid && menu) {
            swapMissSaid = true;
            var texts = [], st = [menu], seen = 0;
            while (st.length && texts.length < 30 && seen < 5000) {
                var p = st.pop();
                seen++;
                if (p.paneltype === 'Label' && String(p.text || '').trim()) texts.push(String(p.text).trim().substring(0, 20));
                for (var i = 0; i < p.GetChildCount(); i++) st.push(p.GetChild(i));
            }
            DLMusic.log("Pause menu: couldn't find Swap Hero (labels: " + texts.join(', ') + ').');
        }
        return swap;
    }

    function PlaceSwap(delay) {
        $.Schedule(delay, function () {
            if (!(escBtn && escBtn.IsValid())) return;
            var swap = FindSwap();
            if (!swap) return;
            swap.style.transform = null;
            $.Schedule(0.05, function () {
                if (!swap.IsValid() || !escBtn.IsValid()) return;
                var sc = swap.actualuiscale_y || 1;
                var sp = swap.GetPositionWithinWindow();
                var swapBottom = sp.y + swap.actuallayoutheight;
                var btnTop = escBtn.GetPositionWithinWindow().y;
                var need = (swapBottom - (btnTop - 6 * sc)) / sc;
                var res = findMenuButton(/resources/i);
                var room = need;
                if (res && res !== swap) {
                    var rp = res.GetPositionWithinWindow();
                    room = (sp.y - (rp.y + res.actuallayoutheight) - 4 * sc) / sc;
                }
                var up = Math.max(0, Math.round(Math.min(need, room)));
                if (up > 0) swap.style.transform = 'translate3d(0px, -' + up + 'px, 0px)';
                var note = 'need ' + Math.round(need) + ', room ' + Math.round(room) + ', raised ' + up;
                if (note !== swapLogged) { swapLogged = note; DevLog('Pause menu: Swap Hero ' + note + 'px.'); }
            });
        });
    }

    var fallbackLogged = false;

    function ensureEscapeButton() {
        var valid = escBtn && escBtn.IsValid && escBtn.IsValid();
        if (valid && placedAboveFeedback) { SpaceEscButton(); return; }
        var fb = findFeedbackButton();
        if (!fb) {
            if (valid) return;
            var anchor = findAnchor();
            if (!anchor) return;
            var existing = anchor.FindChildTraverse ? anchor.FindChildTraverse('DLMusicSettingsBtn') : null;
            escBtn = existing || CreateEscButton(anchor);
            if (!fallbackLogged) { fallbackLogged = true; DLMusic.log('Pause menu: Player Feedback not found yet, Radio button at the bottom.'); }
            return;
        }
        var target = fb;
        while (target.GetParent() && target.GetParent().GetParent() && target.GetParent().GetChildCount() < 3) target = target.GetParent();
        var parent = target.GetParent();
        if (!parent) return;
        if (valid) { escBtn.DeleteAsync(0); }
        escBtn = CreateEscButton(parent);
        escTarget = target;
        try { parent.MoveChildBefore(escBtn, target); placedAboveFeedback = true; } catch (e) { placedAboveFeedback = true; DLMusic.log('Pause menu: could not move the Radio button (' + e + ').'); }
        var names = [];
        try {
            for (var i = 0; i < parent.GetChildCount(); i++) {
                var c = parent.GetChild(i);
                names.push(c.id || c.paneltype);
            }
        } catch (e2) { }
        DLMusic.log('Pause menu: Radio button placed above Player Feedback (' + names.join(', ') + ').');
    }

    function startInjectionLoop() {
        ensureEscapeButton();
        $.Schedule(1.5, startInjectionLoop);
    }

    function Pill(parent, text, cls, onClick) {
        var b = $.CreatePanel('Button', parent, '');
        b.AddClass('DLMPill');
        if (cls) b.AddClass(cls);
        var l = $.CreatePanel('Label', b, '');
        l.text = text;
        b.SetPanelEvent('onactivate', function () { Guard(); CommitAllEntries(); onClick(); });
        return { btn: b, label: l };
    }

    function Clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    function Section(page, title) {
        var block = $.CreatePanel('Panel', page, '');
        block.AddClass('DLMSectionBlock');
        var h = $.CreatePanel('Label', block, '');
        h.AddClass('DLMSectionTitle');
        h.text = title;
        return block;
    }

    function RowShell(parent, name) {
        var row = $.CreatePanel('Panel', parent, '');
        row.AddClass('DLMRow');
        var n = $.CreatePanel('Label', row, '');
        n.AddClass('DLMRowName');
        n.text = name;
        var ctl = $.CreatePanel('Panel', row, '');
        ctl.AddClass('DLMControl');
        return ctl;
    }

    function ToggleRow(parent, name, key) {
        var ctl = RowShell(parent, name);
        var sw = $.CreatePanel('Button', ctl, '');
        sw.AddClass('DLMSwitch');
        var knob = $.CreatePanel('Panel', sw, '');
        knob.AddClass('DLMSwitchKnob');
        knob.hittest = false;
        sw.SetPanelEvent('onactivate', function () {
            Guard();
            CommitAllEntries();
            var s = Settings();
            s[key] = !s[key];
            Changed();
        });
        toggles.push({ btn: sw, key: key });
    }

    function ChoiceRow(parent, name, key, options) {
        var ctl = RowShell(parent, name);
        function step(d) {
            var s = Settings();
            var idx = 0;
            for (var i = 0; i < options.length; i++) if (options[i].v === s[key]) idx = i;
            idx = (idx + d + options.length) % options.length;
            s[key] = options[idx].v;
            Changed();
        }
        Pill(ctl, '<', 'DLMStepBtn', function () { step(-1); });
        var v = $.CreatePanel('Label', ctl, '');
        v.AddClass('DLMChoiceValue');
        Pill(ctl, '>', 'DLMStepBtn', function () { step(1); });
        choices.push({ label: v, key: key, options: options });
    }

    function MakeSlider(parent, lo, hi) {
        var sl = null;
        try { sl = $.CreatePanel('Slider', parent, '', { direction: 'horizontal' }); } catch (e) { sl = null; }
        if (!sl) { try { sl = $.CreatePanel('Slider', parent, ''); } catch (e2) { sl = null; } }
        if (!sl) return null;
        sl.AddClass('HorizontalSlider');
        sl.AddClass('DLMSlider');
        try { sl.direction = 'horizontal'; } catch (e3) { }
        try { sl.min = lo; sl.max = hi; } catch (e4) { }
        return sl;
    }

    function StepperRow(parent, name, key, step, lo, hi, fmt, onAfter) {
        var ctl = RowShell(parent, name);
        var rec = null;
        function set(val) {
            var s = Settings();
            var v = Math.round(val / step) * step;
            s[key] = Clamp(Math.round(v * 100) / 100, lo, hi);
            if (onAfter) onAfter();
            Changed();
        }
        var slider = MakeSlider(ctl, lo, hi);
        var entry = $.CreatePanel('TextEntry', ctl, '');
        entry.AddClass('DLMValueEntry');
        rec = { entry: entry, slider: slider, key: key, fmt: fmt, shown: '', set: set, touchedAt: 0, pushing: false };
        if (slider) {
            slider.SetPanelEvent('onvaluechanged', function () {
                if (rec.pushing) return;
                var v = Number(slider.value);
                if (isNaN(v) || Math.abs(v - Settings()[key]) < step / 2) return;
                rec.touchedAt = Date.now();
                Guard();
                set(v);
            });
        }
        entry.SetPanelEvent('onactivate', Guard);
        entry.SetPanelEvent('oninputsubmit', function () { CommitEntry(rec); });
        valueEntries.push(rec);
    }

    function HasFocus(p) {
        try { return !!(p && p.BHasKeyFocus && p.BHasKeyFocus()); } catch (e) { return false; }
    }

    function CommitEntry(rec) {
        if (!rec || !rec.entry || !rec.entry.IsValid || !rec.entry.IsValid()) return;
        var txt = String(rec.entry.text);
        if (txt === rec.shown) return;
        var num = parseFloat(txt.replace(/[^0-9.\-]/g, ''));
        if (!isNaN(num)) rec.set(num);
        else { rec.shown = ''; RefreshValues(); }
    }

    function TextRow(parent, name, key, btnText, btnFn) {
        var row = $.CreatePanel('Panel', parent, '');
        row.AddClass('DLMRow');
        var n = $.CreatePanel('Label', row, '');
        n.AddClass('DLMRowName');
        n.text = name;
        var entry = $.CreatePanel('TextEntry', row, '');
        entry.AddClass('DLMPathEntry');
        var rec = { entry: entry, key: key, shown: '' };
        entry.SetPanelEvent('onactivate', Guard);
        entry.SetPanelEvent('oninputsubmit', function () { CommitText(rec); });
        textEntries.push(rec);
        if (btnText) { var pb = Pill(row, btnText, 'DLMRowBtn', btnFn); pb.btn.style.verticalAlign = 'center'; }
        return n;
    }

    function CommitText(rec) {
        if (!rec.entry || !rec.entry.IsValid()) return;
        var t = String(rec.entry.text).trim();
        if (t === rec.shown || !t) return;
        Settings()[rec.key] = t;
        rec.shown = t;
        Changed();
    }

    function CommitAllEntries() {
        for (var i = 0; i < valueEntries.length; i++) CommitEntry(valueEntries[i]);
        for (var j = 0; j < textEntries.length; j++) CommitText(textEntries[j]);
    }

    function FmtPct(v) { return Math.round(v) + '%'; }
    function FmtSec(v) { return v.toFixed(2) + 's'; }

    function RefreshValues() {
        var s = Settings();
        var i;
        for (i = 0; i < valueEntries.length; i++) {
            var e = valueEntries[i];
            if (!e.entry || !e.entry.IsValid || !e.entry.IsValid()) continue;
            if (!HasFocus(e.entry)) {
                if (String(e.entry.text) !== e.shown) CommitEntry(e);
                var t = e.fmt(s[e.key]);
                if (e.shown !== t || String(e.entry.text) !== t) { e.entry.text = t; e.shown = t; }
            }
            if (e.slider && e.slider.IsValid() && Date.now() - e.touchedAt > 400) {
                var sv = s[e.key];
                if (Math.abs(Number(e.slider.value) - sv) > 0.0001) {
                    e.pushing = true;
                    try { e.slider.value = sv; } catch (err) { }
                    e.pushing = false;
                }
            }
        }
        for (i = 0; i < textEntries.length; i++) {
            var te = textEntries[i];
            if (!te.entry.IsValid() || HasFocus(te.entry)) continue;
            if (String(te.entry.text).trim() !== te.shown && te.shown !== '') CommitText(te);
            var want = String(s[te.key] || '');
            if (te.shown !== want) { te.entry.text = want; te.shown = want; }
        }
        for (i = 0; i < toggles.length; i++) toggles[i].btn.SetHasClass('DLMSwitchOn', !!s[toggles[i].key]);
        for (i = 0; i < fb.typePills.length; i++) fb.typePills[i].btn.SetHasClass('DLMPillOn', fb.typePills[i].t === fb.type);
        if (zoomBtn && DLMusic.zoomLabel) zoomBtn.zoomLabel.text = 'Zoom: ' + DLMusic.zoomLabel();
        if (updateLink) {
            var nv = DLMusic.latestVersion || '';
            updateLink.text = nv ? nv + ' available!' : '';
            updateLink.parentBtn.style.visibility = nv ? 'visible' : 'collapse';
        }
        RefreshFeedback();
        for (i = 0; i < choices.length; i++) {
            var c = choices[i];
            var lbl = String(s[c.key]);
            for (var j = 0; j < c.options.length; j++) if (c.options[j].v === s[c.key]) lbl = c.options[j].l;
            c.label.text = lbl;
        }
    }

    function RefreshStatus() {
        var s = Settings();
        if (folderBox) folderBox.style.visibility = s.source === 'folder' ? 'visible' : 'collapse';
        if (folderName) {
            var fi = DLMusic.folderInfo;
            folderName.text = !fi || s.source !== 'folder' ? 'Folder' :
                (fi.missing ? 'Folder (not found)' : (fi.blocked ? "Folder (can't open it)" : (fi.loading ? 'Folder (looking...)' : 'Folder (' + fi.count + (fi.count === 1 ? ' song)' : ' songs)'))));
        }
    }

    function AddTab(nav, id, title) {
        var btn = $.CreatePanel('Button', nav, '');
        btn.AddClass('DLMTab');
        var l = $.CreatePanel('Label', btn, '');
        l.text = title;
        btn.SetPanelEvent('onactivate', function () { Guard(); CommitAllEntries(); SetTab(id); });

        var page = $.CreatePanel('Panel', mainScroll, '');
        page.AddClass('DLMPage');

        tabs[id] = { btn: btn, page: page, title: title };
        tabOrder.push(id);
        return page;
    }

    function AddPage(id, title) {
        var page = $.CreatePanel('Panel', mainScroll, '');
        page.AddClass('DLMPage');
        tabs[id] = { btn: null, page: page, title: title };
        tabOrder.push(id);
        return page;
    }

    function NavLink(parent, text, cls, fn) {
        var b = $.CreatePanel('Button', parent, '');
        b.AddClass(cls);
        var l = $.CreatePanel('Label', b, '');
        l.text = text;
        b.SetPanelEvent('onactivate', function () { Guard(); CommitAllEntries(); fn(); });
        return l;
    }

    var BUILTIN_NOTES = [
        { v: '1.2', n: [
            'Shared songs now start from where the other player is, and everyone has their own border on their scoreboard card.',
            'Minimal player style, and an option to hide the album art.',
            'Music folder: a shuffle button on the player, artist and title from the file name, and the folder is found automatically in more setups.',
            'Remember last song: pick up where you left off next game (off by default).',
            'Added browser zoom options.',
            'New Help and Feedback pages.',
            'The queued item icon moved next to your souls, so it no longer clips with the player.'
        ], f: [
            'The progress bar moves smoothly, scrubbing works properly again, and the song jumps when you let go.',
            'YouTube\'s "Continue watching?" pop-up gets answered for you.',
            "Album art and titles don't get stuck on the old song anymore.",
            'Visualizer fixes.'
        ] },
        { v: '1.1', n: ['First release.'], f: [] }
    ];
    var newsPage = null;

    function BuildNews(notes) {
        if (!newsPage || !newsPage.IsValid()) return;
        newsPage.RemoveAndDeleteChildren();
        for (var i = 0; i < notes.length; i++) {
            var o = notes[i];
            if (!o || !o.v) continue;
            var sec = Section(newsPage, 'v' + String(o.v).replace(/^v/i, ''));
            var parts = [['New', o.n || []], ['Fixes', o.f || []]];
            var first = true;
            for (var k = 0; k < parts.length; k++) {
                if (!parts[k][1].length) continue;
                if (parts[k][1].length > 1 || (o.n && o.n.length && o.f && o.f.length)) {
                    var h = $.CreatePanel('Label', sec, '');
                    h.AddClass('DLMHelpTitle');
                    if (!first) h.AddClass('DLMNoteHead');
                    h.text = parts[k][0];
                }
                NoteList(sec, parts[k][1]);
                first = false;
            }
        }
    }

    DLMusic.onNotes = function (notes) {
        if (!notes || !notes.length) return;
        DLMusic.serverNotes = notes;
        BuildNews(notes);
    };

    function HelpItem(parent, title, text) {
        var t = $.CreatePanel('Label', parent, '');
        t.AddClass('DLMHelpTitle');
        t.text = title;
        var b = $.CreatePanel('Label', parent, '');
        b.AddClass('DLMHelpText');
        b.AddClass('DLMHelpBody');
        b.text = text;
    }

    function NoteList(parent, items) {
        for (var i = 0; i < items.length; i++) {
            var l = $.CreatePanel('Label', parent, '');
            l.AddClass('DLMHelpText');
            l.AddClass('DLMNoteItem');
            l.text = '- ' + items[i];
        }
    }

    var FB_WAIT_MS = 5 * 60 * 1000;
    var fbSending = false;

    function FbLeft() {
        var at = Settings().fbAt || 0;
        return Math.max(0, FB_WAIT_MS - (Date.now() - at));
    }

    function RefreshFeedback() {
        if (!fb.msg || !fb.msg.IsValid()) return;
        var txt = String(fb.msg.text);
        if (txt.length > 500) { fb.msg.text = txt.substring(0, 500); txt = fb.msg.text; }
        fb.count.text = txt.length + ' / 500';
        fb.msgHint.style.visibility = txt.length ? 'collapse' : 'visible';
        fb.nameHint.style.visibility = String(fb.name.text).length ? 'collapse' : 'visible';
        var left = FbLeft();
        if (fbSending) fb.send.label.text = 'Sending...';
        else if (left > 0) {
            var sec = Math.ceil(left / 1000);
            fb.send.label.text = Math.floor(sec / 60) + ':' + (sec - Math.floor(sec / 60) * 60 < 10 ? '0' : '') + (sec - Math.floor(sec / 60) * 60);
        } else fb.send.label.text = 'Send';
        fb.send.btn.SetHasClass('DLMPillOff', fbSending || left > 0);
    }

    function SendFeedback() {
        if (fbSending || FbLeft() > 0) return;
        var msg = String(fb.msg.text).trim();
        if (!msg) { fb.status.text = 'Write a message first.'; return; }
        var ok = DLMusic.sendFeedback && DLMusic.sendFeedback({ name: String(fb.name.text).trim().substring(0, 40), type: fb.type, msg: msg.substring(0, 500) });
        if (!ok) { fb.status.text = "The browser isn't ready yet. Try again in a few seconds."; return; }
        fbSending = true;
        fb.status.text = '';
        $.Schedule(15.0, function () { if (fbSending) { fbSending = false; fb.status.text = 'Failed, try again later'; } });
    }

    DLMusic.onFeedbackSent = function (ok) {
        if (!fbSending) return;
        fbSending = false;
        if (ok) {
            Settings().fbAt = Date.now();
            if (DLMusic.settingsChanged) DLMusic.settingsChanged();
            fb.msg.text = '';
            fb.name.text = '';
            fb.status.text = 'Sent. Thanks!';
        } else {
            fb.status.text = 'Failed, try again later';
        }
        RefreshFeedback();
    };

    function SetTab(id) {
        activeTab = id;
        if (Settings().lastTab !== id) {
            Settings().lastTab = id;
            if (DLMusic.settingsChanged) DLMusic.settingsChanged();
        }
        for (var i = 0; i < tabOrder.length; i++) {
            var k = tabOrder[i], t = tabs[k];
            var on = (k === id);
            if (t.btn) t.btn.SetHasClass('DLMTabActive', on);
            t.page.style.visibility = on ? 'visible' : 'collapse';
        }
        if (mainTitle) mainTitle.text = tabs[id].title;
        if (reloadBtn) reloadBtn.style.visibility = id === 'browser' ? 'visible' : 'collapse';
        if (zoomBtn) zoomBtn.style.visibility = id === 'browser' ? 'visible' : 'collapse';
        if (mainScroll) { try { mainScroll.ScrollToTop(); } catch (e) { } }
        if (DLMusic.setBrowserVisible) DLMusic.setBrowserVisible(isOpen && id === 'browser');
        RefreshValues();
        RefreshStatus();
    }

    function buildOverlay() {
        if (overlay && overlay.IsValid && overlay.IsValid()) return;
        var ctx = $.GetContextPanel();
        if (!ctx) return;

        overlay = $.CreatePanel('Panel', ctx, 'DLMusicSettingsRoot');
        overlay.AddClass('DLMusicSettingsRoot');
        overlay.style.visibility = 'collapse';
        overlay.hittest = true;

        var backdrop = $.CreatePanel('Panel', overlay, 'DLMusicSettingsBackdrop');
        backdrop.AddClass('DLMusicSettingsBackdrop');
        backdrop.hittest = true;
        backdrop.SetPanelEvent('onactivate', function () {
            if (Date.now() - clickGuardAt < 150) return;
            Close();
        });

        card = $.CreatePanel('Panel', overlay, 'DLMCard');
        card.AddClass('DLMCard');
        card.hittest = true;
        card.SetPanelEvent('onactivate', Guard);

        var nav = $.CreatePanel('Panel', card, 'DLMNav');
        nav.AddClass('DLMNav');
        var navTop = $.CreatePanel('Panel', nav, 'DLMNavTop');
        navTop.AddClass('DLMNavTop');

        var brand = $.CreatePanel('Label', navTop, '');
        brand.AddClass('DLMBrand');
        brand.text = 'DEADLOCK';
        var brandRow = $.CreatePanel('Panel', navTop, '');
        brandRow.AddClass('DLMBrandRow');
        var brand2 = $.CreatePanel('Label', brandRow, '');
        brand2.AddClass('DLMBrand');
        brand2.AddClass('DLMBrand2');
        brand2.text = 'RADIO';
        var creditRow = $.CreatePanel('Panel', navTop, '');
        creditRow.AddClass('DLMCreditRow');
        var credit = $.CreatePanel('Label', creditRow, '');
        credit.AddClass('DLMCredit');
        credit.text = 'by BubbleGumXD';
        var ver = $.CreatePanel('Label', creditRow, '');
        ver.AddClass('DLMBrandVer');
        ver.text = 'v' + (DLMusic.modVersion || '1.2') + (DLMusic.dev ? ' DEV' : '');
        var upd = $.CreatePanel('Button', navTop, '');
        upd.AddClass('DLMUpdateLink');
        updateLink = $.CreatePanel('Label', upd, '');
        upd.SetPanelEvent('onactivate', function () { Guard(); if (DLMusic.openModPage) DLMusic.openModPage(); });
        updateLink.parentBtn = upd;
        upd.style.visibility = 'collapse';

        var tabList = $.CreatePanel('Panel', navTop, '');
        tabList.AddClass('DLMTabList');

        var back = $.CreatePanel('Button', nav, 'DLMBack');
        back.AddClass('DLMBack');
        var bk = $.CreatePanel('Label', back, '');
        bk.AddClass('DLMBackKey');
        bk.text = 'ESC';
        var bl = $.CreatePanel('Label', back, '');
        bl.AddClass('DLMBackLabel');
        bl.text = 'BACK';
        back.SetPanelEvent('onactivate', function () { Guard(); Close(); });

        var low = $.CreatePanel('Panel', nav, 'DLMNavLow');
        low.AddClass('DLMNavLow');
        NavLink(low, "What's new", 'DLMNavBig', function () { SetTab('news'); });
        NavLink(low, 'Feedback', 'DLMNavBig', function () { SetTab('feedback'); });
        var rl = NavLink(low, 'Reset to defaults', 'DLMNavSmall', function () {
            if (Date.now() - resetArmed < 3000) {
                resetArmed = 0;
                rl.text = 'Reset to defaults';
                if (DLMusic.resetSettings) DLMusic.resetSettings();
                RefreshValues();
                return;
            }
            resetArmed = Date.now();
            rl.text = 'Click again to reset';
            $.Schedule(3.0, function () { if (resetArmed && Date.now() - resetArmed >= 2900) { resetArmed = 0; rl.text = 'Reset to defaults'; } });
        });
        rl.GetParent().AddClass('DLMNavGap');
        var resetArmed = 0;
        NavLink(low, 'Buy me a coffee', 'DLMNavSmall', function () {
            try { $.DispatchEvent('ExternalBrowserGoToURL', 'https://buymeacoffee.com/bubblegumxd'); } catch (e) { }
        });

        var main = $.CreatePanel('Panel', card, 'DLMMain');
        main.AddClass('DLMMain');

        var mainHead = $.CreatePanel('Panel', main, '');
        mainHead.AddClass('DLMMainHead');
        mainTitle = $.CreatePanel('Label', mainHead, '');
        mainTitle.AddClass('DLMMainTitle');
        var headBtns = $.CreatePanel('Panel', mainHead, '');
        headBtns.AddClass('DLMHeadBtns');
        var zp = Pill(headBtns, 'Zoom: Auto', 'DLMHeadBtn', function () { if (DLMusic.cycleZoom) DLMusic.cycleZoom(); RefreshValues(); });
        zoomBtn = zp.btn;
        zoomBtn.zoomLabel = zp.label;
        zoomBtn.style.visibility = 'collapse';
        reloadBtn = Pill(headBtns, 'Reload', 'DLMHeadBtn', function () { if (DLMusic.reloadBrowser) DLMusic.reloadBrowser(); }).btn;
        reloadBtn.style.visibility = 'collapse';

        mainScroll = $.CreatePanel('Panel', main, 'DLMMainScroll');
        mainScroll.AddClass('DLMMainScroll');

        var pp = AddTab(tabList, 'playback', 'Playback');

        var sSrc = Section(pp, 'Source');
        ChoiceRow(sSrc, 'Music source', 'source', [{ v: 'youtube', l: 'YouTube' }, { v: 'folder', l: 'Music folder' }]);
        folderBox = $.CreatePanel('Panel', sSrc, 'DLMFolderBox');
        folderBox.AddClass('DLMFolderBox');
        folderName = TextRow(folderBox, 'Folder', 'folderPath', 'Refresh', function () { if (DLMusic.reloadFolder) DLMusic.reloadFolder(); });
        folderBox.style.visibility = 'collapse';

        var sVol = Section(pp, 'Volume');
        StepperRow(sVol, 'Normal volume', 'normalVol', 1, 0, 100, FmtPct);
        StepperRow(sVol, 'Quiet volume', 'quietVol', 1, 0, 100, FmtPct);

        var sCom = Section(pp, 'Combat');
        ToggleRow(sCom, 'Lower music in combat', 'duckEnabled');
        StepperRow(sCom, 'Combat volume', 'combatVol', 1, 0, 100, FmtPct);
        StepperRow(sCom, 'Fade out (entering combat)', 'fadeOutSec', 0.05, 0, 5, FmtSec);
        StepperRow(sCom, 'Fade in (after combat)', 'fadeInSec', 0.05, 0, 10, FmtSec);
        StepperRow(sCom, 'Stay lowered after combat', 'holdSec', 0.1, 0, 15, FmtSec);

        var sTab = Section(pp, 'Tabbed out');
        ChoiceRow(sTab, 'When tabbed out', 'tabMode', [{ v: 'mute', l: 'Mute' }, { v: 'pause', l: 'Pause' }, { v: 'play', l: 'Keep playing' }]);

        var sSongs = Section(pp, 'Songs');
        ToggleRow(sSongs, 'Remember last song', 'rememberSong');
        var rsl = $.CreatePanel('Label', sSongs, '');
        rsl.AddClass('DLMHelpText');
        rsl.text = 'Next time you start the game, your last song is ready where you left off.';

        var sYt = Section(pp, 'YouTube');
        ToggleRow(sYt, 'Skip ads', 'skipAds');


        var pz = AddTab(tabList, 'look', 'Personalize');

        var sHud = Section(pz, 'Player');
        ToggleRow(sHud, 'Show player on the HUD', 'showHud');
        ToggleRow(sHud, 'Show album art', 'showArt');
        ChoiceRow(sHud, 'Player style', 'playerStyle', [{ v: 'full', l: 'Full' }, { v: 'minimal', l: 'Minimal' }]);

        var sPrev = Section(pz, 'Preview');
        var prevRow = $.CreatePanel('Panel', sPrev, '');
        prevRow.AddClass('DLMPreviewRow');
        if (DLMusic.buildPreviewPlayer && !previewBuilt) { DLMusic.buildPreviewPlayer(prevRow); previewBuilt = true; }

        var sBor = Section(pz, 'Border');
        ToggleRow(sBor, 'Album art border', 'artBorder');
        ChoiceRow(sBor, 'Border style', 'borderStyle', [
            { v: 'gold', l: 'Gold' }, { v: 'silver', l: 'Silver' }, { v: 'dark', l: 'Dark' },
            { v: 'neon', l: 'Neon' }, { v: 'glass', l: 'Glass' }]);

        var sGl = Section(pz, 'Gloss and sheen');
        StepperRow(sGl, 'Gloss', 'gloss', 1, 0, 100, FmtPct);
        ToggleRow(sGl, 'Sheen', 'sheen');
        StepperRow(sGl, 'Sheen speed', 'sheenSec', 0.05, 0.3, 5, FmtSec);
        StepperRow(sGl, 'Sheen delay (min)', 'sheenDelayMin', 0.1, 0, 60, FmtSec, function () {
            var s = Settings(); if (s.sheenDelayMax < s.sheenDelayMin) s.sheenDelayMax = s.sheenDelayMin;
        });
        StepperRow(sGl, 'Sheen delay (max)', 'sheenDelayMax', 0.1, 0, 60, FmtSec, function () {
            var s = Settings(); if (s.sheenDelayMin > s.sheenDelayMax) s.sheenDelayMin = s.sheenDelayMax;
        });

        var sViz = Section(pz, 'Visualizer');
        ToggleRow(sViz, 'Audio visualizer', 'visualizer');
        ChoiceRow(sViz, 'Bass position', 'vizPos', [{ v: 'left', l: 'Left' }, { v: 'center', l: 'Center' }, { v: 'right', l: 'Right' }]);
        StepperRow(sViz, 'Sensitivity', 'vizSens', 1, 20, 300, FmtPct);
        StepperRow(sViz, 'Smoothness', 'vizSmooth', 1, 0, 100, FmtPct);

        var psh = AddTab(tabList, 'sharing', 'Sharing');
        var sSh = Section(psh, 'Sharing');
        ToggleRow(sSh, 'Share songs', 'shareSongs');
        var shl = $.CreatePanel('Label', sSh, '');
        shl.AddClass('DLMHelpText');
        shl.text = 'Other Deadlock Radio players in your match see your song under your name when they hold Tab, and you see theirs. Click a song to play it. When this is off, nothing is sent or received.';

        var ph = AddTab(tabList, 'help', 'Help');
        var sHelp = Section(ph, 'How it works');
        HelpItem(sHelp, 'Using the player', 'The player sits next to your abilities. Hold Tab to use the buttons or drag the progress bar.');
        HelpItem(sHelp, 'Quiet mode', 'Click on the album art to lower the music to your quiet volume. Click it again to bring it back. If you have the album art hidden, click on the song title instead.');
        HelpItem(sHelp, 'In combat', "The music will get quieter while you're in combat and will come back afterwards. You can change how quiet it gets and how fast it fades in the Playback tab.");
        HelpItem(sHelp, 'Your own music', "Make a folder called deadlockradio_music in Deadlock\\game\\citadel\\addons and put your songs in it, then set the music source to Music folder. If it can't find your folder, copy the folder's location and paste it into the Folder box. If your files are named Artist - Title, both will show on the player. The shuffle button on the player plays your songs in a random order.");
        HelpItem(sHelp, 'Sharing', 'Share songs allows others in your match to see what you are listening to, if they are using Deadlock Radio too. The song they are listening to will appear under their character while holding Tab. Click on the album art to play their song in your player.');
        HelpItem(sHelp, "Something's not working", "Press Reload at the top of the Browser tab. If that doesn't fix it, press Reset to defaults in the bottom left to put your settings back to normal.");

        AddTab(tabList, 'browser', 'Browser');

        newsPage = AddPage('news', "What's new");
        BuildNews(DLMusic.serverNotes || BUILTIN_NOTES);

        var pf = AddPage('feedback', 'Feedback');
        var sFb = Section(pf, 'Send feedback');
        var typeBox = $.CreatePanel('Panel', sFb, '');
        typeBox.AddClass('DLMFbTypes');
        ['Bug', 'Suggestion', 'Other'].forEach(function (t) {
            var p = Pill(typeBox, t, 'DLMTypePill', function () { fb.type = t; RefreshValues(); });
            fb.typePills.push({ btn: p.btn, t: t });
        });
        var nameBox = $.CreatePanel('Panel', sFb, '');
        nameBox.AddClass('DLMFbNameBox');
        fb.name = $.CreatePanel('TextEntry', nameBox, '', { maxchars: '40' });
        fb.name.AddClass('DLMFbName');
        try { fb.name.SetMaxChars(40); } catch (e) { }
        fb.name.SetPanelEvent('onactivate', Guard);
        fb.nameHint = $.CreatePanel('Label', nameBox, '');
        fb.nameHint.AddClass('DLMFbHint');
        fb.nameHint.text = 'Name (optional)';
        fb.nameHint.hittest = false;
        var msgBox = $.CreatePanel('Panel', sFb, '');
        msgBox.AddClass('DLMFbMsgBox');
        fb.msg = $.CreatePanel('TextEntry', msgBox, '', { maxchars: '500', multiline: 'true' });
        fb.msg.AddClass('DLMFbMsg');
        try { fb.msg.SetMaxChars(500); } catch (e) { }
        try { fb.msg.multiline = true; } catch (e) { }
        fb.msg.SetPanelEvent('onactivate', Guard);
        fb.msgHint = $.CreatePanel('Label', msgBox, '');
        fb.msgHint.AddClass('DLMFbHint');
        fb.msgHint.AddClass('DLMFbHintTop');
        fb.msgHint.text = 'Message';
        fb.msgHint.hittest = false;
        var fr4 = $.CreatePanel('Panel', sFb, '');
        fr4.AddClass('DLMFbFoot');
        fb.count = $.CreatePanel('Label', fr4, '');
        fb.count.AddClass('DLMFbCount');
        fb.count.text = '0 / 500';
        fb.send = Pill(fr4, 'Send', 'DLMFbSend', function () { SendFeedback(); });
        fb.status = $.CreatePanel('Label', sFb, '');
        fb.status.AddClass('DLMHelpText');
        fb.status.AddClass('DLMFbStatus');
        fb.status.text = '';
        var gb = NavLink(sFb, 'Or comment on GameBanana', 'DLMNavSmall', function () { if (DLMusic.openModPage) DLMusic.openModPage(); });
        gb.GetParent().AddClass('DLMFbGb');

    }

    function Open() {
        buildOverlay();
        if (!overlay) return;
        isOpen = true;
        openedAt = Date.now();
        overlay.style.visibility = 'visible';
        if (DLMusic.ensureCEFPanel) DLMusic.ensureCEFPanel();
        if (DLMusic.checkVersion) DLMusic.checkVersion(false);
        SetTab(tabs[Settings().lastTab] ? Settings().lastTab : 'playback');
        PollWhileOpen();
    }

    function Close() {
        if (!overlay || !isOpen) return;
        isOpen = false;
        CommitAllEntries();
        if (DLMusic.setBrowserVisible) DLMusic.setBrowserVisible(false);
        overlay.style.visibility = 'collapse';
    }

    function Toggle() {
        if (isOpen) Close(); else Open();
    }

    DLMusic.isMenuOpen = function () { return isOpen; };

    function PollWhileOpen() {
        if (!isOpen) return;
        if (DLMusic.escMenuOpen && Date.now() - openedAt > 300) {
            var open = DLMusic.escMenuOpen();
            if (!open && DLMusic.escClassSeen && DLMusic.escClassSeen()) {
                DLMusic.log('Pause menu closed, closing Radio menu.');
                Close();
                return;
            }
        }
        RefreshValues();
        RefreshStatus();
        $.Schedule(0.25, PollWhileOpen);
    }

    $.Schedule(0.5, startInjectionLoop);
})();
