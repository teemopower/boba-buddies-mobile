"use strict";
/**
 * Boba Buddies — pure game logic (mobile port).
 *
 * Faithful TypeScript port of the browser extension's
 * `~/workspace/extensions/pocket-pals/extension/shared.js` plus the
 * action effects from `popup.js` (doMeal/doSnack/doDrink/doClean/
 * doMedicine/doPotty/doScold/doPet, gameReward, shop buy/equip).
 *
 * This module is PURE: no React Native, no storage, no notifications.
 * Everything here is a plain function over plain data, so it can be
 * unit-tested in plain node (see scripts/verify-logic.ts).
 *
 * Tuning is copied EXACTLY from shared.js — do not "improve" it here.
 * Anything the extension leaves ambiguous is marked ASSUMPTION below.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOW_METER_ALERTS = exports.PP = void 0;
exports.ppClamp = ppClamp;
exports.ppDefaultPetState = ppDefaultPetState;
exports.ppDefaultSave = ppDefaultSave;
exports.ppHatchInMs = ppHatchInMs;
exports.ppAgeDays = ppAgeDays;
exports.ppStageIndex = ppStageIndex;
exports.ppDailyBonus = ppDailyBonus;
exports.ppAllGreenBonus = ppAllGreenBonus;
exports.ppIsOwned = ppIsOwned;
exports.ppMaybeTriggerEvents = ppMaybeTriggerEvents;
exports.ppIsSparkle = ppIsSparkle;
exports.ppApplyDecay = ppApplyDecay;
exports.ppDeriveMood = ppDeriveMood;
exports.ppPetById = ppPetById;
exports.ppIsQuietHour = ppIsQuietHour;
exports.ppDayString = ppDayString;
exports.ppApplyDailyBonuses = ppApplyDailyBonuses;
exports.ppLowMeterAlert = ppLowMeterAlert;
exports.ppDoMeal = ppDoMeal;
exports.ppDoSnack = ppDoSnack;
exports.ppDoDrink = ppDoDrink;
exports.ppDoBath = ppDoBath;
exports.ppDoMedicine = ppDoMedicine;
exports.ppDoSleepToggle = ppDoSleepToggle;
exports.ppDoPotty = ppDoPotty;
exports.ppDoScold = ppDoScold;
exports.ppDoPet = ppDoPet;
exports.ppGameReward = ppGameReward;
exports.ppBuyShopItem = ppBuyShopItem;
exports.ppEquipBackground = ppEquipBackground;
exports.ppToggleHat = ppToggleHat;
exports.ppMarkOwnedPet = ppMarkOwnedPet;
exports.PP = {
    VERSION: 1,
    STORAGE_KEY: 'bobaBuddiesMobile',
    // Decay per hour while awake (meters are 0-100).
    // Tuned Nov 23 for a 3-check-ins-a-day loop (morning / lunch / dinner):
    // from full, hunger hits 30 in ~6h and thirst in ~5h, so a missed
    // midday check-in is felt by dinner. Sleeping decays at 1/4 rate.
    DECAY_PER_HOUR: { hunger: 12, thirst: 14, energy: 6, happiness: 4, cleanliness: 3 },
    // Health drifts: -2/hr when dirty or starving, +1/hr when everything is fine.
    HEALTH_RECOVER_PER_HOUR: 1,
    HEALTH_DAMAGE_PER_HOUR: 2,
    // Growth (v1.0): the egg hatches in 5 minutes, then 1 real day = 1 stage step.
    // Egg -> Baby (5 min) -> Child (1 day after hatch) -> Teen (2 days) -> Adult (3 days).
    EGG_MS: 5 * 60 * 1000,
    STAGES: ['Egg', 'Baby', 'Child', 'Teen', 'Adult'],
    PETS: [
        { id: 'momo', name: 'Momo', price: 0, img: 'img/momo.png', headTop: 0.037, fav: 'Mochi', favDrink: 'Milk tea', blurb: 'A sleepy mochi blob. Based on Muse.',
            frames: { blink: 'img/momo-blink.png', eat: 'img/momo-eat.png', drink: 'img/momo-drink.png', happy: 'img/momo-happy.png', sad: 'img/momo-sad.png', sleep: 'img/momo-sleep.png' },
            frameTop: { blink: 0.0586, eat: 0.0508, drink: 0.0527, happy: 0.0781, sad: 0.0508, sleep: 0.0625 } },
        { id: 'kiki', name: 'Kiki', price: 0, img: 'img/kiki.png', headTop: 0.057, fav: 'Fetch', favDrink: 'Juice', blurb: 'A hyper fox kit. Gets the zoomies.',
            frames: { blink: 'img/kiki-blink.png', eat: 'img/kiki-eat.png', drink: 'img/kiki-drink.png', happy: 'img/kiki-happy.png', sad: 'img/kiki-sad.png', sleep: 'img/kiki-sleep.png' },
            frameTop: { blink: 0.0742, eat: 0.0684, drink: 0.0703, happy: 0.0625, sad: 0.1562, sleep: 0.0742 } },
        { id: 'boba', name: 'Boba', price: 0.98, img: 'img/boba.png', headTop: 0.016, fav: 'Bubble tea', favDrink: 'Boba tea', blurb: 'A dreamy axolotl with a boba hat.',
            frames: { blink: 'img/boba-blink.png', eat: 'img/boba-eat.png', drink: 'img/boba-drink.png', happy: 'img/boba-happy.png', sad: 'img/boba-sad.png', sleep: 'img/boba-sleep.png' },
            frameTop: { blink: 0.0293, eat: 0.0234, drink: 0.0215, happy: 0.0312, sad: 0.0293, sleep: 0.0254 } },
        { id: 'yuki', name: 'Yuki', price: 0.99, img: 'img/yuki.png', headTop: 0.086, fav: 'Carrot cake', favDrink: 'Cocoa', blurb: 'A shy bunny in a blue scarf.',
            frames: { blink: 'img/yuki-blink.png', eat: 'img/yuki-eat.png', drink: 'img/yuki-drink.png', happy: 'img/yuki-happy.png', sad: 'img/yuki-sad.png', sleep: 'img/yuki-sleep.png' },
            frameTop: { blink: 0.1152, eat: 0.0938, drink: 0.1035, happy: 0.0938, sad: 0.0996, sleep: 0.1133 } },
        { id: 'taro', name: 'Taro', price: 1.49, img: 'img/taro.png', headTop: 0.01, fav: 'Taro milk', favDrink: 'Taro milk', blurb: 'A chill foodie cat.',
            frames: { blink: 'img/taro-blink.png', eat: 'img/taro-eat.png', drink: 'img/taro-drink.png', happy: 'img/taro-happy.png', sad: 'img/taro-sad.png', sleep: 'img/taro-sleep.png' },
            frameTop: { blink: 0.0117, eat: 0.0117, drink: 0.0098, happy: 0.0137, sad: 0.0176, sleep: 0.0117 } },
        { id: 'purin', name: 'Purin', price: 0.97, img: 'img/purin.png', headTop: 0.008, fav: 'Pudding', favDrink: 'Milk', blurb: 'A goofy pudding dog.',
            frames: { blink: 'img/purin-blink.png', eat: 'img/purin-eat.png', drink: 'img/purin-drink.png', happy: 'img/purin-happy.png', sad: 'img/purin-sad.png', sleep: 'img/purin-sleep.png' },
            frameTop: { blink: 0.0176, eat: 0.0176, drink: 0.0195, happy: 0.0215, sad: 0.0273, sleep: 0.0254 } },
        { id: 'sora', name: 'Sora', price: 1.48, img: 'img/sora.png', headTop: 0.006, fav: 'Cloud naps', favDrink: 'Cloud tea', blurb: 'A floaty cloud sheep.',
            frames: { blink: 'img/sora-blink.png', eat: 'img/sora-eat.png', drink: 'img/sora-drink.png', happy: 'img/sora-happy.png', sad: 'img/sora-sad.png', sleep: 'img/sora-sleep.png' },
            frameTop: { blink: 0.0078, eat: 0.0078, drink: 0.0098, happy: 0.0078, sad: 0.0117, sleep: 0.0098 } },
        { id: 'miso', name: 'Miso', price: 1.47, img: 'img/miso.png', headTop: 0.012, fav: 'Ramen', favDrink: 'Miso soup', blurb: 'A cozy red panda.',
            frames: { blink: 'img/miso-blink.png', eat: 'img/miso-eat.png', drink: 'img/miso-drink.png', happy: 'img/miso-happy.png', sad: 'img/miso-sad.png', sleep: 'img/miso-sleep.png' },
            frameTop: { blink: 0.0176, eat: 0.0176, drink: 0.0176, happy: 0.0391, sad: 0.0273, sleep: 0.0176 } },
        { id: 'hana', name: 'Hana', price: 1.99, img: 'img/hana.png', headTop: 0.008, fav: 'Sakura mochi', favDrink: 'Sakura tea', blurb: 'A gentle sakura fawn. Legendary.',
            frames: { blink: 'img/hana-blink.png', eat: 'img/hana-eat.png', drink: 'img/hana-drink.png', happy: 'img/hana-happy.png', sad: 'img/hana-sad.png', sleep: 'img/hana-sleep.png' },
            frameTop: { blink: 0.0117, eat: 0.0156, drink: 0.0137, happy: 0.0137, sad: 0.0156, sleep: 0.0137 } },
        { id: 'nori', name: 'Nori', price: 0.96, img: 'img/nori.png', headTop: 0.057, fav: 'Onigiri', favDrink: 'Green tea', blurb: 'A sleepy onigiri, wrapped snug.',
            frames: { blink: 'img/nori-blink.png', eat: 'img/nori-eat.png', drink: 'img/nori-drink.png', happy: 'img/nori-happy.png', sad: 'img/nori-sad.png', sleep: 'img/nori-sleep.png' },
            frameTop: { blink: 0.0742, eat: 0.0645, drink: 0.0645, happy: 0.0859, sad: 0.0684, sleep: 0.0645 } },
    ],
    SHOP: [
        { id: 'bow', name: 'Pink Bow', price: 40, icon: '🎀', desc: 'A cute bow Momo wears on its sprout.', kind: 'hat' },
        { id: 'starToy', name: 'Star Toy', price: 25, icon: '⭐', desc: 'Playing earns +8 extra Happiness.', kind: 'passive' },
        { id: 'bobaTea', name: 'Boba Tea', price: 10, icon: '🧋', desc: 'A tasty drink: +40 Thirst, +8 Happy.', kind: 'drink' },
        { id: 'blanket', name: 'Cozy Blanket', price: 60, icon: '🛏️', desc: 'Sleep restores Energy twice as fast.', kind: 'passive' },
        { id: 'treatJar', name: 'Treat Jar', price: 15, icon: '🍪', desc: 'A jar of treats: +30 Hunger, +10 Happy.', kind: 'food' },
        { id: 'garden', name: 'Sunny Garden', price: 60, icon: '🌸', desc: 'A sunny garden room theme.', kind: 'bg' },
        { id: 'night', name: 'Cozy Night', price: 60, icon: '🌙', desc: 'A starry night room theme.', kind: 'bg' },
    ],
    MOODS: {
        sleeping: { label: 'Sleeping', bubble: 'Zzz… 💤' },
        sick: { label: 'Sick', bubble: 'I feel awful… 🤒' },
        grumpy: { label: 'Grumpy', bubble: 'Hmph! Leave me alone! 😤' },
        potty: { label: 'Potty!', bubble: 'I need the potty! 🚽' },
        sad: { label: 'Sad', bubble: 'Please… take care of me… 😢' },
        hungry: { label: 'Hungry', bubble: 'My tummy is rumbling… 🍡' },
        thirsty: { label: 'Thirsty', bubble: 'So thirsty… 🧋' },
        sleepy: { label: 'Sleepy', bubble: 'So… sleepy… 🥱' },
        dirty: { label: 'Dirty', bubble: 'I feel all grubby… 🧼' },
        bored: { label: 'Bored', bubble: 'Play with me? 🥺' },
        lonely: { label: 'Lonely', bubble: 'Where did you go…? 🥺' },
        excited: { label: 'Excited', bubble: 'That was the best!! ✨' },
        happy: { label: 'Happy', bubble: 'I love you! 💕' },
        content: { label: 'Content', bubble: "Hi! I'm doing okay. ♡" },
    },
};
/** Low-meter reminder copy, verbatim from background.js.
 * Order matters: only the FIRST low meter fires per tick. */
exports.LOW_METER_ALERTS = [
    { meter: 'hunger', titleSuffix: 'is hungry! 🍡', body: (n) => `Feed ${n} a meal.` },
    { meter: 'thirst', titleSuffix: 'is thirsty! 🧋', body: (n) => `Give ${n} a drink.` },
    { meter: 'energy', titleSuffix: 'is sleepy… 💤', body: (n) => `Tuck ${n} in for a nap.` },
    { meter: 'happiness', titleSuffix: 'is bored… 🥺', body: (n) => `Play a game with ${n}.` },
    { meter: 'cleanliness', titleSuffix: 'is dirty! 🧼', body: (n) => `${n} could use a bath.` },
    { meter: 'health', titleSuffix: 'is feeling sick… 🤒', body: (n) => `${n} needs medicine.` },
];
function ppClamp(v, min = 0, max = 100) {
    return Math.max(min, Math.min(max, Math.round(v)));
}
function ppDefaultPetState(now) {
    return {
        meters: { hunger: 80, thirst: 80, energy: 80, happiness: 80, cleanliness: 80, health: 90 },
        weight: 10,
        bornAt: now,
        lastSeen: now,
        lastInteract: now,
        lightsOut: false,
        careMistakes: 0,
        zeroFlags: {},
        dosesTaken: 0,
        excitedUntil: 0,
        notified: {},
        streak: { lastDay: null, count: 0 },
        allGreenDay: null,
        hatOn: false,
        hatchedAt: 0,
        pottyPending: false,
        pottyAt: 0,
        mess: false,
        tantrumUntil: 0,
    };
}
function ppDefaultSave(now) {
    const pets = {};
    for (const p of exports.PP.PETS)
        pets[p.id] = ppDefaultPetState(now);
    return {
        version: exports.PP.VERSION,
        activePet: 'momo',
        coins: 50,
        shop: { owned: [], blanket: false, starToy: false, bg: null },
        ownedPets: [],
        pets,
        createdAt: now,
    };
}
/** Milliseconds until the egg hatches (0 once hatched). */
function ppHatchInMs(state, now) {
    return Math.max(0, exports.PP.EGG_MS - (now - state.bornAt));
}
/** Age in whole days since birth. */
function ppAgeDays(state, now) {
    return Math.max(0, Math.floor((now - state.bornAt) / 86400000));
}
/** Growth stage index 0..4 (Egg..Adult).
 * v1.0: the egg hatches 5 minutes after adoption, then 1 day = 1 step
 * (Baby on the hatch day, Child 1 day after hatch, Teen 2 days, Adult 3 days). */
function ppStageIndex(state, now) {
    const elapsed = now - state.bornAt;
    if (elapsed < exports.PP.EGG_MS)
        return 0;
    const daysSinceHatch = Math.floor((elapsed - exports.PP.EGG_MS) / 86400000);
    return Math.min(exports.PP.STAGES.length - 1, 1 + daysSinceHatch);
}
/** Daily-visit coin bonus, scaled by streak: +10, +12, … up to +30. */
function ppDailyBonus(streakCount) {
    return 10 + Math.min(20, 2 * Math.max(0, streakCount - 1));
}
/** All-green-meters day bonus: +5, or +10 on a 7+ day streak. */
function ppAllGreenBonus(streakCount) {
    return streakCount >= 7 ? 10 : 5;
}
/** Is a pet owned? Free pets are always owned. */
function ppIsOwned(save, petId) {
    const pet = ppPetById(petId);
    if (pet.price === 0)
        return true;
    return Array.isArray(save.ownedPets) && save.ownedPets.includes(petId);
}
/**
 * Random care events (potty needs, tantrums). Called on ticks, not on open,
 * so they only fire while the game is actually running. `rand` is injectable
 * for tests (defaults to Math.random).
 */
function ppMaybeTriggerEvents(state, now, rand = Math.random) {
    const stageIdx = ppStageIndex(state, now);
    if (state.lightsOut)
        return;
    // Potty: only after hatching, ~2% per tick, not if one is already pending or messy.
    if (stageIdx > 0 && !state.pottyPending && !state.mess && rand() < 0.02) {
        state.pottyPending = true;
        state.pottyAt = now;
    }
    // Tantrum: only from Child on, not while sick, ~1.5% per tick, lasts 5 min.
    if (stageIdx > 1 && state.meters.health >= 30 && now >= state.tantrumUntil && rand() < 0.015) {
        state.tantrumUntil = now + 5 * 60 * 1000;
    }
}
function ppIsSparkle(state, now) {
    return ppStageIndex(state, now) === exports.PP.STAGES.length - 1 && state.careMistakes <= 2;
}
/** Apply real-time decay for elapsed ms. Mutates + returns state. */
function ppApplyDecay(state, now, opts = {}) {
    const elapsedMs = Math.max(0, now - state.lastSeen);
    const hours = elapsedMs / 3600000;
    if (hours <= 0) {
        state.lastSeen = now;
        return state;
    }
    const m = state.meters;
    const d = exports.PP.DECAY_PER_HOUR;
    if (state.lightsOut) {
        // Sleeping: energy recovers, everything else decays slowly (1/4 rate),
        // so the ~13h overnight gap doesn't wreck the pet — it wakes up needy
        // but fine, which prompts the morning check-in.
        m.energy = ppClamp(m.energy + (opts.blanket ? 20 : 10) * hours);
        m.hunger = ppClamp(m.hunger - d.hunger * 0.25 * hours);
        m.thirst = ppClamp(m.thirst - d.thirst * 0.25 * hours);
        m.happiness = ppClamp(m.happiness - d.happiness * 0.25 * hours);
        m.cleanliness = ppClamp(m.cleanliness - d.cleanliness * 0.25 * hours);
    }
    else {
        m.hunger = ppClamp(m.hunger - d.hunger * hours);
        m.thirst = ppClamp(m.thirst - d.thirst * hours);
        m.energy = ppClamp(m.energy - d.energy * hours);
        m.happiness = ppClamp(m.happiness - d.happiness * hours);
        m.cleanliness = ppClamp(m.cleanliness - d.cleanliness * hours);
    }
    // Health: damage when starving/dirty/overweight, recovery when all is well.
    const stressed = m.cleanliness < 20 || m.hunger === 0 || state.weight > 30;
    const fine = m.hunger > 50 && m.thirst > 50 && m.cleanliness > 50 && m.health > 0;
    if (stressed)
        m.health = ppClamp(m.health - exports.PP.HEALTH_DAMAGE_PER_HOUR * hours);
    else if (fine)
        m.health = ppClamp(m.health + exports.PP.HEALTH_RECOVER_PER_HOUR * hours);
    // Care mistakes: each meter dipping to 0 counts once per dip.
    for (const key of Object.keys(m)) {
        if (m[key] === 0 && !state.zeroFlags[key]) {
            state.zeroFlags[key] = true;
            state.careMistakes += 1;
        }
        else if (m[key] > 0) {
            state.zeroFlags[key] = false;
        }
    }
    // Potty ignored for 30+ minutes -> a mess on the floor (bath clears it).
    if (state.pottyPending && now - state.pottyAt > 30 * 60 * 1000) {
        state.pottyPending = false;
        state.mess = true;
        state.meters.cleanliness = Math.min(state.meters.cleanliness, 40);
    }
    // Tantrum left alone until it expires -> the pet sulks (-5 happiness, once).
    if (state.tantrumUntil && now >= state.tantrumUntil) {
        state.tantrumUntil = 0;
        state.meters.happiness = ppClamp(state.meters.happiness - 5);
    }
    state.lastSeen = now;
    return state;
}
/** Derive the current mood id from state. Priority order matters. */
function ppDeriveMood(state, now) {
    const m = state.meters;
    if (state.lightsOut)
        return 'sleeping';
    if (m.health < 30)
        return 'sick';
    if (now < state.tantrumUntil)
        return 'grumpy';
    if (state.pottyPending)
        return 'potty';
    const anyZero = Object.values(m).some((v) => v === 0);
    if (anyZero || (m.happiness < 15 && (m.hunger < 20 || m.thirst < 20)))
        return 'sad';
    if (m.hunger < 30)
        return 'hungry';
    if (m.thirst < 30)
        return 'thirsty';
    if (m.energy < 30)
        return 'sleepy';
    if (m.cleanliness < 30)
        return 'dirty';
    if (m.happiness < 30)
        return 'bored';
    if (now - state.lastInteract > 8 * 3600000)
        return 'lonely';
    if (now < state.excitedUntil)
        return 'excited';
    if (m.hunger > 70 && m.thirst > 70 && m.energy > 70 && m.happiness > 70 && m.cleanliness > 70 && m.health > 70)
        return 'happy';
    return 'content';
}
function ppPetById(id) {
    return exports.PP.PETS.find((p) => p.id === id) || exports.PP.PETS[0];
}
/** Quiet hours: no notifications 22:00–08:00 local. */
function ppIsQuietHour(date) {
    const h = date.getHours();
    return h >= 22 || h < 8;
}
function ppDayString(date) {
    return date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate();
}
/**
 * Daily streak + all-green bonus, ported from popup.js init().
 * Call once per open (after decay), on the ACTIVE pet only.
 * Returns the coins awarded (0 when nothing is due). Mutates save.
 * All-green requires every meter > 80 (strictly), same as the extension.
 */
function ppApplyDailyBonuses(save, now) {
    const state = save.pets[save.activePet];
    if (!state)
        return { streakBonus: 0, allGreenBonus: 0 };
    const today = ppDayString(new Date(now));
    const yesterday = ppDayString(new Date(now - 86400000));
    let streakBonus = 0;
    let allGreenBonus = 0;
    if (state.streak.lastDay !== today) {
        state.streak.count = state.streak.lastDay === yesterday ? state.streak.count + 1 : 1;
        state.streak.lastDay = today;
        streakBonus = ppDailyBonus(state.streak.count);
        save.coins += streakBonus;
    }
    const m = state.meters;
    if (m.hunger > 80 &&
        m.thirst > 80 &&
        m.energy > 80 &&
        m.happiness > 80 &&
        m.cleanliness > 80 &&
        m.health > 80 &&
        state.allGreenDay !== today) {
        state.allGreenDay = today;
        allGreenBonus = ppAllGreenBonus(state.streak.count);
        save.coins += allGreenBonus;
    }
    return { streakBonus, allGreenBonus };
}
/**
 * Low-meter reminder decision, ported from background.js's alarm tick.
 * Pure: returns the single alert to send (first low meter only, in
 * hunger/thirst/energy/happiness/cleanliness/health order), or null.
 * A meter fires only when < 25 and not notified in the last 2 hours,
 * and never during quiet hours (22:00–08:00 local). Does NOT mutate;
 * the caller records `notified[meter] = now` after scheduling.
 */
function ppLowMeterAlert(state, petName, now) {
    if (ppIsQuietHour(new Date(now)))
        return null;
    for (const alert of exports.LOW_METER_ALERTS) {
        if (state.meters[alert.meter] < 25) {
            const last = state.notified[alert.meter] || 0;
            if (now - last > 2 * 3600000) {
                return { meter: alert.meter, title: `${petName} ${alert.titleSuffix}`, body: alert.body(petName) };
            }
            break; // only the most urgent need per tick (matches background.js)
        }
    }
    return null;
}
// ---------------------------------------------------------------------------
// Actions (ported from popup.js). Each mutates the passed state/save and
// stamps lastInteract exactly where popup.js calls touch(). The store wraps
// these in a cloned save + derived-field recompute; they are pure enough
// to be verified in plain node.
// ---------------------------------------------------------------------------
function touch(state, now) {
    state.lastInteract = now;
}
/** Meal: +40 hunger, +3 happiness, weight +1. (popup.js doMeal) */
function ppDoMeal(state, now) {
    state.meters.hunger = ppClamp(state.meters.hunger + 40);
    state.meters.happiness = ppClamp(state.meters.happiness + 3);
    state.weight += 1;
    touch(state, now);
}
/** Snack: +5 hunger, +15 happiness, weight +2. (popup.js doSnack) */
function ppDoSnack(state, now) {
    state.meters.happiness = ppClamp(state.meters.happiness + 15);
    state.meters.hunger = ppClamp(state.meters.hunger + 5);
    state.weight += 2;
    touch(state, now);
}
/** Drink: +40 thirst, +2 happiness. (popup.js doDrink) */
function ppDoDrink(state, now) {
    state.meters.thirst = ppClamp(state.meters.thirst + 40);
    state.meters.happiness = ppClamp(state.meters.happiness + 2);
    touch(state, now);
}
/** Bath: cleanliness = 100, +5 happiness, clears any mess. (popup.js doClean) */
function ppDoBath(state, now) {
    state.meters.cleanliness = 100;
    state.meters.happiness = ppClamp(state.meters.happiness + 5);
    state.mess = false;
    touch(state, now);
}
/**
 * Medicine: only when the mood is sick (health < 30 and awake — popup.js
 * gates on `mood !== 'sick'`) and only with >= 10 coins. Costs 10 coins,
 * +25 health. Cured at health >= 30 (dosesTaken resets to 0, as in popup.js).
 * Returns false when blocked (no coins spent, nothing changed).
 */
function ppDoMedicine(save, now) {
    const state = save.pets[save.activePet];
    if (!state)
        return false;
    if (ppDeriveMood(state, now) !== 'sick' || save.coins < 10)
        return false;
    save.coins -= 10;
    state.meters.health = ppClamp(state.meters.health + 25);
    state.dosesTaken += 1;
    touch(state, now);
    if (state.meters.health >= 30)
        state.dosesTaken = 0;
    return true;
}
/** Sleep toggle: lights out on/off. (popup.js doSleepToggle) */
function ppDoSleepToggle(state, now) {
    state.lightsOut = !state.lightsOut;
    touch(state, now);
}
/**
 * Potty: blocked while asleep; no-op when no potty is pending.
 * Success: +8 happiness, +2 coins. (popup.js doPotty)
 */
function ppDoPotty(save, now) {
    const state = save.pets[save.activePet];
    if (!state || state.lightsOut || !state.pottyPending)
        return false;
    state.pottyPending = false;
    state.pottyAt = 0;
    state.meters.happiness = ppClamp(state.meters.happiness + 8);
    save.coins += 2;
    touch(state, now);
    return true;
}
/**
 * Scold: only during an active tantrum; ends it and +5 happiness.
 * (popup.js doScold — no happiness penalty for scolding; the -5 only
 * lands when a tantrum is IGNORED until it expires, in ppApplyDecay.)
 */
function ppDoScold(state, now) {
    if (now >= state.tantrumUntil)
        return false;
    state.tantrumUntil = 0;
    state.meters.happiness = ppClamp(state.meters.happiness + 5);
    touch(state, now);
    return true;
}
/** Click-to-pet: +2 happiness; blocked while asleep. (popup.js doPet) */
function ppDoPet(state, now) {
    if (state.lightsOut)
        return false;
    state.meters.happiness = ppClamp(state.meters.happiness + 2);
    touch(state, now);
    return true;
}
/**
 * Mini-game reward (popup.js gameReward). Games themselves are NOT in this
 * module — the UI calls this with the result.
 * Blocked when sick or sad (returns null, nothing changes).
 * Win: +15 coins, +12 happiness (+8 more with Star Toy), weight -1,
 * excited for 30s. Lose: +3 coins, +4 happiness.
 */
function ppGameReward(save, won, now) {
    const state = save.pets[save.activePet];
    if (!state)
        return null;
    const mood = ppDeriveMood(state, now);
    if (mood === 'sick' || mood === 'sad')
        return null;
    if (won) {
        const bonus = save.shop.starToy ? 8 : 0;
        state.meters.happiness = ppClamp(state.meters.happiness + 12 + bonus);
        state.weight = Math.max(0, state.weight - 1);
        save.coins += 15;
        state.excitedUntil = now + 30000;
        touch(state, now);
        return { coins: 15, happy: 12 + bonus };
    }
    state.meters.happiness = ppClamp(state.meters.happiness + 4);
    save.coins += 3;
    touch(state, now);
    return { coins: 3, happy: 4 };
}
// ---------------------------------------------------------------------------
// Shop (ported from popup.js renderShop buy handler)
// ---------------------------------------------------------------------------
/**
 * Buy a shop item. Returns false when the purchase cannot happen
 * (unknown id, not enough coins, durable already owned) — nothing changes.
 * - bow (owned already): toggles the hat instead, returns true.
 * - bobaTea (drink) / treatJar (food): consumables — NOT added to
 *   shop.owned; bobaTea also sets excitedUntil +30s (popup.js).
 * - starToy / blanket (passive): added to owned + flag set.
 * - garden / night (bg): added to owned + equipped immediately.
 */
function ppBuyShopItem(save, id, now) {
    const state = save.pets[save.activePet];
    const item = exports.PP.SHOP.find((s) => s.id === id);
    if (!item || !state)
        return false;
    if (id === 'bow' && save.shop.owned.includes('bow')) {
        state.hatOn = !state.hatOn;
        return true;
    }
    if (save.coins < item.price)
        return false;
    save.coins -= item.price;
    if (item.kind === 'drink') {
        state.meters.thirst = ppClamp(state.meters.thirst + 40);
        state.meters.happiness = ppClamp(state.meters.happiness + 8);
        state.excitedUntil = now + 30000;
        touch(state, now);
        return true;
    }
    if (item.kind === 'food') {
        state.meters.hunger = ppClamp(state.meters.hunger + 30);
        state.meters.happiness = ppClamp(state.meters.happiness + 10);
        touch(state, now);
        return true;
    }
    if (save.shop.owned.includes(id)) {
        // Durable already owned — refund the deduction above.
        save.coins += item.price;
        return false;
    }
    save.shop.owned.push(id);
    if (id === 'bow')
        state.hatOn = true;
    if (id === 'starToy')
        save.shop.starToy = true;
    if (id === 'blanket')
        save.shop.blanket = true;
    if (item.kind === 'bg')
        save.shop.bg = id;
    return true;
}
/** Equip an owned room background. Returns false when not owned / not a bg. */
function ppEquipBackground(save, id) {
    const item = exports.PP.SHOP.find((s) => s.id === id);
    if (!item || item.kind !== 'bg')
        return false;
    if (!save.shop.owned.includes(id))
        return false;
    save.shop.bg = id;
    return true;
}
/** Toggle the Pink Bow. Only works when the bow is owned. */
function ppToggleHat(save) {
    const state = save.pets[save.activePet];
    if (!state || !save.shop.owned.includes('bow'))
        return false;
    state.hatOn = !state.hatOn;
    return true;
}
/**
 * Record a pet purchase (RevenueCat side on mobile). Additive only — never
 * removes a pet. 'adopt-all' unlocks all 8 paid pets (mirrors the
 * extension's bundle nickname). Returns true if anything changed.
 * (ExtensionPay's ppOwnedFromPlan/ppOwnedFromUser are intentionally NOT
 * ported — no ExtensionPay on mobile.)
 */
function ppMarkOwnedPet(save, id) {
    if (!Array.isArray(save.ownedPets))
        save.ownedPets = [];
    if (id === 'adopt-all') {
        let changed = false;
        for (const p of exports.PP.PETS) {
            if (p.price > 0 && !save.ownedPets.includes(p.id)) {
                save.ownedPets.push(p.id);
                changed = true;
            }
        }
        return changed;
    }
    const pet = exports.PP.PETS.find((p) => p.id === id && p.price > 0);
    if (pet && !save.ownedPets.includes(pet.id)) {
        save.ownedPets.push(pet.id);
        return true;
    }
    return false;
}
