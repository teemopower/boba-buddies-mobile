/// <reference types="node" />
/**
 * scripts/verify-logic.ts — verifies src/game/logic.ts against the
 * browser extension's numbers (shared.js + popup.js).
 *
 * What it does:
 *  1. Compiles src/game/logic.ts with tsc to /tmp/boba-logic-check
 *     (standalone — logic.ts has no imports, so this proves it is
 *     dependency-free pure logic).
 *  2. Loads the compiled JS in plain node and runs assertions.
 *
 * Run from the project root:
 *   npx tsc scripts/verify-logic.ts --ignoreConfig --rootDir . \
 *     --outDir /tmp/boba-verify-run --module commonjs --target es2022 \
 *     --esModuleInterop --skipLibCheck \
 *   && node /tmp/boba-verify-run/scripts/verify-logic.js
 *
 * Exit code 0 = every check passed; 1 = at least one failed.
 * (The project-wide `npx tsc --noEmit` separately typechecks this file
 * and src/game/*.ts.)
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const LOGIC_SRC = path.join(ROOT, 'src', 'game', 'logic.ts');
const OUT_DIR = '/tmp/boba-logic-check';

let failures = 0;
let passes = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected;
  if (ok) {
    passes += 1;
    console.log(`PASS  ${name} (=${String(expected)})`);
  } else {
    failures += 1;
    console.log(`FAIL  ${name} — expected ${String(expected)}, got ${String(actual)}`);
  }
}

function checkTrue(name: string, cond: boolean): void {
  check(name, cond, true);
}

async function main(): Promise<void> {
  // --- Step 1: compile logic.ts standalone to /tmp -------------------------
  const tscBin = path.join(ROOT, 'node_modules', '.bin', 'tsc');
  const tscCmd = fs.existsSync(tscBin) ? tscBin : 'npx tsc';
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Compiling ${LOGIC_SRC} -> ${OUT_DIR} ...`);
  try {
    execSync(
      `"${tscCmd}" "${LOGIC_SRC}" --ignoreConfig --outDir "${OUT_DIR}" --module commonjs --target es2022 --strict --skipLibCheck`,
      { stdio: 'pipe' },
    );
    console.log('PASS  logic.ts compiles standalone with tsc (strict)');
    passes += 1;
  } catch (e) {
    failures += 1;
    console.log('FAIL  logic.ts failed to compile standalone');
    console.log((e as { stdout?: Buffer }).stdout?.toString() ?? String(e));
    process.exitCode = 1;
    return;
  }

  // --- Step 2: load compiled logic + assert --------------------------------
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const L = (await import(path.join(OUT_DIR, 'logic.js'))) as typeof import('../src/game/logic');

  const NOW = Date.now();
  const HOUR = 3600000;

  /** A pet state with every meter at 100, lastSeen `hoursAgo` hours back. */
  function fullState(hoursAgo: number, extra: Partial<ReturnType<typeof L.ppDefaultPetState>> = {}) {
    const s = L.ppDefaultPetState(NOW);
    s.meters = { hunger: 100, thirst: 100, energy: 100, happiness: 100, cleanliness: 100, health: 100 };
    s.lastSeen = NOW - hoursAgo * HOUR;
    Object.assign(s, extra);
    return s;
  }

  // --- Required check 1: 5.5h awake from full ------------------------------
  {
    const s = fullState(5.5);
    L.ppApplyDecay(s, NOW);
    check('5.5h awake: hunger', s.meters.hunger, 34); // 100 - 12*5.5
    check('5.5h awake: thirst', s.meters.thirst, 23); // 100 - 14*5.5
  }

  // --- Required check 2: 10h asleep from full ------------------------------
  {
    const s = fullState(10, { lightsOut: true });
    L.ppApplyDecay(s, NOW);
    check('10h asleep: hunger', s.meters.hunger, 70); // 100 - 12*0.25*10
    check('10h asleep: thirst', s.meters.thirst, 65); // 100 - 14*0.25*10
    check('10h asleep: energy recovers to full', s.meters.energy, 100);
  }

  // --- Required check 3: 11h awake from full -------------------------------
  {
    const s = fullState(11);
    L.ppApplyDecay(s, NOW);
    check('11h awake: hunger', s.meters.hunger, 0);
    check('11h awake: thirst', s.meters.thirst, 0);
    check('11h awake: careMistakes (hunger + thirst)', s.careMistakes, 2);
    check('11h awake: mood', L.ppDeriveMood(s, NOW), 'sad');
  }

  // --- Required check 4: potty window --------------------------------------
  {
    const pending29 = fullState(29 / 60, { pottyPending: true, pottyAt: NOW - 29 * 60 * 1000 });
    L.ppApplyDecay(pending29, NOW);
    checkTrue('potty still pending at +29 min', pending29.pottyPending);
    checkTrue('no mess at +29 min', !pending29.mess);

    const pending31 = fullState(31 / 60, { pottyPending: true, pottyAt: NOW - 31 * 60 * 1000 });
    pending31.meters.cleanliness = 80;
    L.ppApplyDecay(pending31, NOW);
    checkTrue('potty cleared at +31 min', !pending31.pottyPending);
    checkTrue('mess at +31 min', pending31.mess);
    check('mess caps cleanliness at 40', pending31.meters.cleanliness, 40);
  }

  // --- Required check 5: egg hatches at exactly 5 min ----------------------
  {
    const justBefore = L.ppDefaultPetState(NOW);
    justBefore.bornAt = NOW - L.PP.EGG_MS + 1;
    check('egg: 1ms before 5 min is still Egg', L.ppStageIndex(justBefore, NOW), 0);
    check('egg: hatch in 1ms', L.ppHatchInMs(justBefore, NOW), 1);

    const atHatch = L.ppDefaultPetState(NOW);
    atHatch.bornAt = NOW - L.PP.EGG_MS;
    check('egg: exactly 5 min -> Baby', L.ppStageIndex(atHatch, NOW), 1);
    check('egg: hatch in 0ms once hatched', L.ppHatchInMs(atHatch, NOW), 0);
  }

  // --- Required check 6: stages after hatch --------------------------------
  // "Day N" counts the hatch day as day 1: Baby day 1, Child day 2,
  // Teen day 3, Adult day 4 (shared.js: Child 1 day after hatch, etc).
  {
    const at = (msAfterHatch: number) => {
      const s = L.ppDefaultPetState(NOW);
      s.bornAt = NOW - L.PP.EGG_MS - msAfterHatch;
      return L.ppStageIndex(s, NOW);
    };
    check('stage at hatch -> Baby (1)', at(0), 1);
    check('stage 23h after hatch -> Baby (1)', at(23 * HOUR), 1);
    check('stage 1 day after hatch -> Child (2)', at(24 * HOUR), 2);
    check('stage 2 days after hatch -> Teen (3)', at(48 * HOUR), 3);
    check('stage 3 days after hatch -> Adult (4)', at(72 * HOUR), 4);
    check('stage 30 days after hatch stays Adult (4)', at(30 * 24 * HOUR), 4);
  }

  // --- Required check 7: meal +40, drink +40 -------------------------------
  {
    const s = L.ppDefaultPetState(NOW);
    s.meters.hunger = 50;
    s.meters.happiness = 50;
    s.weight = 10;
    L.ppDoMeal(s, NOW);
    check('meal: hunger +40', s.meters.hunger, 90);
    check('meal: happiness +3', s.meters.happiness, 53);
    check('meal: weight +1', s.weight, 11);

    const d = L.ppDefaultPetState(NOW);
    d.meters.thirst = 50;
    d.meters.happiness = 50;
    L.ppDoDrink(d, NOW);
    check('drink: thirst +40', d.meters.thirst, 90);
    check('drink: happiness +2', d.meters.happiness, 52);
  }

  // --- Required check 8: streak bonus math ----------------------------------
  {
    check('streak bonus day 1', L.ppDailyBonus(1), 10);
    check('streak bonus day 7', L.ppDailyBonus(7), 22); // 10 + 2*6
    check('streak bonus day 11 (cap)', L.ppDailyBonus(11), 30);
    check('streak bonus day 20 (cap)', L.ppDailyBonus(20), 30);
    check('all-green bonus, 6-day streak', L.ppAllGreenBonus(6), 5);
    check('all-green bonus, 7-day streak', L.ppAllGreenBonus(7), 10);
  }

  // --- Extra: other action numbers (popup.js) -------------------------------
  {
    const s = L.ppDefaultPetState(NOW);
    s.meters.hunger = 50;
    s.meters.happiness = 50;
    L.ppDoSnack(s, NOW);
    check('snack: hunger +5', s.meters.hunger, 55);
    check('snack: happiness +15', s.meters.happiness, 65);
    check('snack: weight +2', s.weight, 12);

    const b = L.ppDefaultPetState(NOW);
    b.meters.cleanliness = 40;
    b.meters.happiness = 50;
    b.mess = true;
    L.ppDoBath(b, NOW);
    check('bath: cleanliness = 100', b.meters.cleanliness, 100);
    check('bath: happiness +5', b.meters.happiness, 55);
    checkTrue('bath clears mess', !b.mess);

    const p = L.ppDefaultPetState(NOW);
    p.meters.happiness = 50;
    p.lightsOut = true;
    check('pet blocked while asleep', L.ppDoPet(p, NOW), false);
    p.lightsOut = false;
    check('pet works awake', L.ppDoPet(p, NOW), true);
    check('pet: happiness +2', p.meters.happiness, 52);
  }

  // --- Extra: potty reward / scold / medicine -------------------------------
  {
    const save = L.ppDefaultSave(NOW);
    const st = save.pets.momo;
    st.meters.happiness = 50;
    st.pottyPending = true;
    st.pottyAt = NOW;
    check('potty succeeds when pending', L.ppDoPotty(save, NOW), true);
    check('potty: happiness +8', st.meters.happiness, 58);
    check('potty: +2 coins', save.coins, 52);
    check('potty blocked when none pending', L.ppDoPotty(save, NOW), false);

    const sc = L.ppDefaultPetState(NOW);
    sc.tantrumUntil = NOW + 60_000;
    sc.meters.happiness = 50;
    check('scold ends tantrum', L.ppDoScold(sc, NOW), true);
    check('scold: tantrum cleared', sc.tantrumUntil, 0);
    check('scold: happiness +5', sc.meters.happiness, 55);
    check('scold no-op with no tantrum', L.ppDoScold(sc, NOW), false);

    const med = L.ppDefaultSave(NOW);
    const ms = med.pets.momo;
    ms.meters.health = 20; // sick
    check('medicine works when sick', L.ppDoMedicine(med, NOW), true);
    check('medicine: -10 coins', med.coins, 40);
    check('medicine: health +25', ms.meters.health, 45);
    check('medicine: cured resets doses', ms.dosesTaken, 0);
    check('medicine blocked when healthy', L.ppDoMedicine(med, NOW), false);
  }

  // --- Extra: health drift ---------------------------------------------------
  {
    // Fine (all > 50): +1/hr.
    const s = L.ppDefaultPetState(NOW);
    s.meters = { hunger: 80, thirst: 80, energy: 80, happiness: 80, cleanliness: 80, health: 50 };
    s.lastSeen = NOW - 2 * HOUR;
    L.ppApplyDecay(s, NOW);
    check('health recovers +1/hr when fine', s.meters.health, 52);

    // Stressed (hunger 0): -2/hr.
    const d = fullState(11);
    L.ppApplyDecay(d, NOW);
    check('health takes -2/hr when starving', d.meters.health, 78); // 100 - 2*11
  }

  // --- Extra: sleep energy recovery + quarter-rate decay --------------------
  {
    const s = L.ppDefaultPetState(NOW);
    s.meters.energy = 0;
    s.meters.hunger = 100;
    s.lightsOut = true;
    s.lastSeen = NOW - 5 * HOUR;
    L.ppApplyDecay(s, NOW);
    check('sleep: energy +10/hr', s.meters.energy, 50);
    check('sleep: hunger decays at 1/4 rate', s.meters.hunger, 85); // 100 - 12*0.25*5
  }

  // --- Extra: ignored tantrum sulks -5 ---------------------------------------
  {
    const s = L.ppDefaultPetState(NOW);
    s.meters.happiness = 80;
    s.tantrumUntil = NOW - 1000; // expired 1s ago
    s.lastSeen = NOW - 60_000;
    L.ppApplyDecay(s, NOW);
    check('ignored tantrum: -5 happiness', s.meters.happiness, 75);
    check('ignored tantrum: cleared', s.tantrumUntil, 0);
  }

  // --- Extra: mood priority ---------------------------------------------------
  {
    const mk = (over: Partial<ReturnType<typeof L.ppDefaultPetState>> = {}) => {
      const s = L.ppDefaultPetState(NOW);
      Object.assign(s, over);
      return s;
    };
    check('mood: sleeping beats sick', L.ppDeriveMood(mk({ lightsOut: true, meters: { hunger: 80, thirst: 80, energy: 80, happiness: 80, cleanliness: 80, health: 10 } }), NOW), 'sleeping');
    check('mood: sick (health < 30)', L.ppDeriveMood(mk({ meters: { hunger: 80, thirst: 80, energy: 80, happiness: 80, cleanliness: 80, health: 20 } }), NOW), 'sick');
    check('mood: grumpy beats potty', L.ppDeriveMood(mk({ tantrumUntil: NOW + 60_000, pottyPending: true }), NOW), 'grumpy');
    check('mood: potty beats hungry', L.ppDeriveMood(mk({ pottyPending: true, meters: { hunger: 10, thirst: 80, energy: 80, happiness: 80, cleanliness: 80, health: 90 } }), NOW), 'potty');
    check('mood: hungry', L.ppDeriveMood(mk({ meters: { hunger: 10, thirst: 80, energy: 80, happiness: 80, cleanliness: 80, health: 90 } }), NOW), 'hungry');
    check('mood: thirsty', L.ppDeriveMood(mk({ meters: { hunger: 80, thirst: 10, energy: 80, happiness: 80, cleanliness: 80, health: 90 } }), NOW), 'thirsty');
    check('mood: lonely after 8h no interact', L.ppDeriveMood(mk({ lastInteract: NOW - 9 * HOUR }), NOW), 'lonely');
    check('mood: happy when all > 70', L.ppDeriveMood(mk({ meters: { hunger: 80, thirst: 80, energy: 80, happiness: 80, cleanliness: 80, health: 90 } }), NOW), 'happy');
    check('mood: content otherwise', L.ppDeriveMood(mk({ meters: { hunger: 50, thirst: 50, energy: 50, happiness: 50, cleanliness: 50, health: 50 } }), NOW), 'content');
  }

  // --- Extra: roster / shop verbatim ------------------------------------------
  {
    check('roster: 10 pets', L.PP.PETS.length, 10);
    check('roster ids', L.PP.PETS.map((p) => p.id).join(','), 'momo,kiki,boba,yuki,taro,purin,sora,miso,hana,nori');
    check('shop: 7 items', L.PP.SHOP.length, 7);
    check('shop ids', L.PP.SHOP.map((s) => s.id).join(','), 'bow,starToy,bobaTea,blanket,treatJar,garden,night');
    check('boba price', L.ppPetById('boba').price, 0.98);
    check('hana price', L.ppPetById('hana').price, 1.99);
  }

  // --- Extra: ownership + sparkle ----------------------------------------------
  {
    const save = L.ppDefaultSave(NOW);
    checkTrue('momo (free) always owned', L.ppIsOwned(save, 'momo'));
    checkTrue('boba locked before purchase', !L.ppIsOwned(save, 'boba'));
    checkTrue('markOwnedPet unlocks boba', L.ppMarkOwnedPet(save, 'boba'));
    checkTrue('boba owned after purchase', L.ppIsOwned(save, 'boba'));
    checkTrue('adopt-all unlocks the rest', L.ppMarkOwnedPet(save, 'adopt-all'));
    checkTrue('hana owned after adopt-all', L.ppIsOwned(save, 'hana'));

    const adult = L.ppDefaultPetState(NOW);
    adult.bornAt = NOW - L.PP.EGG_MS - 3 * 24 * HOUR;
    adult.careMistakes = 2;
    checkTrue('sparkle: Adult with <= 2 mistakes', L.ppIsSparkle(adult, NOW));
    adult.careMistakes = 3;
    checkTrue('no sparkle: Adult with 3 mistakes', !L.ppIsSparkle(adult, NOW));
  }

  // --- Extra: random events (injectable rand) -----------------------------------
  {
    const baby = L.ppDefaultPetState(NOW);
    baby.bornAt = NOW - L.PP.EGG_MS; // Baby: potty eligible, tantrum not
    L.ppMaybeTriggerEvents(baby, NOW, () => 0.001);
    checkTrue('potty triggers at rand 0.001 (Baby)', baby.pottyPending);
    checkTrue('no tantrum for Baby', baby.tantrumUntil === 0);

    const child = L.ppDefaultPetState(NOW);
    child.bornAt = NOW - L.PP.EGG_MS - 24 * HOUR; // Child
    L.ppMaybeTriggerEvents(child, NOW, () => 0.99);
    checkTrue('no events at rand 0.99', !child.pottyPending && child.tantrumUntil === 0);

    const asleep = L.ppDefaultPetState(NOW);
    asleep.bornAt = NOW - L.PP.EGG_MS - 24 * HOUR;
    asleep.lightsOut = true;
    L.ppMaybeTriggerEvents(asleep, NOW, () => 0.001);
    checkTrue('no events while asleep', !asleep.pottyPending && asleep.tantrumUntil === 0);
  }

  // --- Extra: game reward ---------------------------------------------------------
  {
    const save = L.ppDefaultSave(NOW);
    const st = save.pets.momo;
    st.meters.happiness = 50;
    st.weight = 10;
    const win = L.ppGameReward(save, true, NOW);
    check('game win: +15 coins', win?.coins, 15);
    check('game win: +12 happiness', win?.happy, 12);
    check('game win: coins in save', save.coins, 65);
    check('game win: weight -1', st.weight, 9);
    checkTrue('game win: excited 30s', st.excitedUntil === NOW + 30000);

    save.shop.starToy = true;
    st.meters.happiness = 50;
    const winToy = L.ppGameReward(save, true, NOW);
    check('game win with Star Toy: +20 happiness', winToy?.happy, 20);

    const lose = L.ppGameReward(save, false, NOW);
    check('game loss: +3 coins', lose?.coins, 3);
    check('game loss: +4 happiness', lose?.happy, 4);

    const sad = L.ppDefaultSave(NOW);
    sad.pets.momo.meters.hunger = 0; // -> sad mood
    check('game blocked when sad', L.ppGameReward(sad, true, NOW), null);
    const sick = L.ppDefaultSave(NOW);
    sick.pets.momo.meters.health = 10;
    check('game blocked when sick', L.ppGameReward(sick, true, NOW), null);
  }

  // --- Extra: shop buy/equip -------------------------------------------------------
  {
    const save = L.ppDefaultSave(NOW); // 50 coins
    check('buy bow: ok', L.ppBuyShopItem(save, 'bow', NOW), true);
    check('buy bow: -40 coins', save.coins, 10);
    checkTrue('buy bow: worn', save.pets.momo.hatOn);
    check('buy bow again: toggles hat, no charge', L.ppBuyShopItem(save, 'bow', NOW), true);
    check('buy bow again: coins unchanged', save.coins, 10);
    checkTrue('buy bow again: hat off', !save.pets.momo.hatOn);
    check('buy garden with 10 coins: blocked', L.ppBuyShopItem(save, 'garden', NOW), false);
    check('equip unowned garden: blocked', L.ppEquipBackground(save, 'garden'), false);

    const rich = L.ppDefaultSave(NOW);
    rich.coins = 200;
    check('buy garden: ok', L.ppBuyShopItem(rich, 'garden', NOW), true);
    check('buy garden: equipped immediately', rich.shop.bg, 'garden');
    check('buy night: ok', L.ppBuyShopItem(rich, 'night', NOW), true);
    check('buy night: equipped', rich.shop.bg, 'night');
    check('equip garden again: ok', L.ppEquipBackground(rich, 'garden'), true);
    check('equip garden: bg switched', rich.shop.bg, 'garden');
    check('buy bobaTea: ok', L.ppBuyShopItem(rich, 'bobaTea', NOW), true);
    checkTrue('bobaTea NOT in owned (consumable)', !rich.shop.owned.includes('bobaTea'));
    check('buy unknown item: blocked', L.ppBuyShopItem(rich, 'nope', NOW), false);
  }

  // --- Extra: daily bonuses ----------------------------------------------------------
  {
    const save = L.ppDefaultSave(NOW);
    const st = save.pets.momo;
    st.streak = { lastDay: L.ppDayString(new Date(NOW - 86400000)), count: 1 };
    const res = L.ppApplyDailyBonuses(save, NOW);
    check('daily: streak continues to 2', st.streak.count, 2);
    check('daily: streak bonus +12', res.streakBonus, 12);
    check('daily: coins include bonus', save.coins, 62);
    const again = L.ppApplyDailyBonuses(save, NOW);
    check('daily: same-day second call pays 0', again.streakBonus, 0);

    const green = L.ppDefaultSave(NOW);
    const g = green.pets.momo;
    g.meters = { hunger: 90, thirst: 90, energy: 90, happiness: 90, cleanliness: 90, health: 90 };
    g.streak = { lastDay: L.ppDayString(new Date(NOW - 86400000)), count: 6 };
    const gr = L.ppApplyDailyBonuses(green, NOW);
    check('daily: streak 7 after continue', g.streak.count, 7);
    check('daily: all-green bonus +10 on 7+ streak', gr.allGreenBonus, 10);
  }

  // --- Extra: low-meter alert decision (background.js) --------------------------------
  {
    const s = L.ppDefaultPetState(NOW);
    s.meters.hunger = 10;
    s.meters.thirst = 10; // hunger is first in order
    const alert = L.ppLowMeterAlert(s, 'Momo', NOW);
    check('alert: first low meter wins (hunger)', alert?.meter, 'hunger');
    check('alert: title wording', alert?.title, 'Momo is hungry! 🍡');
    check('alert: body wording', alert?.body, 'Feed Momo a meal.');

    const throttled = L.ppDefaultPetState(NOW);
    throttled.meters.hunger = 10;
    throttled.notified.hunger = NOW - 60 * 60 * 1000; // notified 1h ago
    check('alert: throttled within 2h', L.ppLowMeterAlert(throttled, 'Momo', NOW), null);

    const fine = L.ppDefaultPetState(NOW);
    check('alert: nothing low, no alert', L.ppLowMeterAlert(fine, 'Momo', NOW), null);

    const quiet = L.ppDefaultPetState(NOW);
    quiet.meters.hunger = 10;
    const late = new Date(NOW);
    late.setHours(23, 0, 0, 0);
    check('alert: quiet hours suppress', L.ppLowMeterAlert(quiet, 'Momo', late.getTime()), null);
    const early = new Date(NOW);
    early.setHours(7, 59, 0, 0);
    checkTrue('quiet hours: 07:59 is quiet', L.ppIsQuietHour(early));
    const morning = new Date(NOW);
    morning.setHours(8, 0, 0, 0);
    checkTrue('quiet hours: 08:00 is not quiet', !L.ppIsQuietHour(morning));
  }

  // --- Summary -----------------------------------------------------------------------
  console.log(`\n${passes} passed, ${failures} failed.`);
  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('verify-logic crashed:', e);
  process.exitCode = 1;
});
