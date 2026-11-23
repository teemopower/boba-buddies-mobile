/**
 * Play screen — the 3 mini-games, with the extension's EXACT rules
 * (popup.js):
 *
 *  - Catch the Star: catch 8 stars in 15s, tap the ⭐ where it spawns.
 *  - Memory Match: 8 cards, 4 pairs (🍡🧋⭐🍓); flip two, a match stays,
 *    a mismatch flips back after 700ms.
 *  - Jump!: clear 8 rocks in 30s; tap JUMP when a rock reaches the pet.
 *    A rock in the pet zone (6%..18%) while the pet is on the ground
 *    ends the game.
 *
 * Every game calls the module-level gameReward(won) from the game store:
 * win +15 coins / +12 happiness (+8 more with Star Toy) / weight −1 /
 * excited 30s; lose +3 coins / +4 happiness. Games are blocked when the
 * pet is sick or sad, with the extension's toast wording.
 *
 * Music: playtime while on this tab.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { audioPlayer } from '../audio/player';
import { gameReward, useGameStore } from '../game/store';
import { COLORS, sharedStyles } from './theme';
import { useToast } from './helpers';

type GameId = 'star' | 'memory' | 'jump';

const GAMES: { id: GameId; emoji: string; name: string; desc: string }[] = [
  { id: 'star', emoji: '⭐', name: 'Catch the Star', desc: 'Catch 8 stars in 15 seconds!' },
  { id: 'memory', emoji: '🃏', name: 'Memory Match', desc: 'Find all 4 pairs: 🍡🧋⭐🍓' },
  { id: 'jump', emoji: '🐰', name: 'Jump!', desc: 'Clear 8 rocks in 30 seconds!' },
];

export default function PlayScreen() {
  const insets = useSafeAreaInsets();
  const mood = useGameStore((s) => s.mood);
  const coins = useGameStore((s) => s.save.coins);
  const [openGame, setOpenGame] = useState<GameId | null>(null);
  const { showToast, ToastView } = useToast();

  useFocusEffect(
    useCallback(() => {
      void audioPlayer.setMusicMode('playtime');
      return () => {
        void audioPlayer.setMusicMode('daytime');
      };
    }, []),
  );

  const open = (id: GameId) => {
    if (mood === 'sick') {
      showToast('Too sick to play — give medicine first! 🤒');
      audioPlayer.playSfx('error');
      return;
    }
    if (mood === 'sad') {
      showToast('Too sad to play — fix a need first! 🥺');
      audioPlayer.playSfx('error');
      return;
    }
    audioPlayer.playSfx('button');
    setOpenGame(id);
  };

  return (
    <View style={[sharedStyles.page, { paddingTop: insets.top }]}>
      <View style={sharedStyles.header}>
        <Text style={sharedStyles.brand}>🎮 Play</Text>
        <Text style={sharedStyles.coins} testID="coins">🪙 {coins}</Text>
      </View>
      <ScrollView contentContainerStyle={sharedStyles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={sharedStyles.title}>Mini-games</Text>
        <Text style={sharedStyles.sub}>
          Win a game: +15 coins, +12 happiness (Star Toy: +8 more), weight −1. Just playing: +3 coins, +4 happiness.
        </Text>
        {mood === 'sick' || mood === 'sad' ? (
          <Text style={styles.blocked}>
            {mood === 'sick'
              ? 'Too sick to play — give medicine first! 🤒'
              : 'Too sad to play — fix a need first! 🥺'}
          </Text>
        ) : null}
        <View style={styles.list}>
          {GAMES.map((g) => (
            <Pressable
              key={g.id}
              style={styles.card}
              onPress={() => open(g.id)}
              disabled={mood === 'sick' || mood === 'sad'}
              testID={`game-${g.id}`}
            >
              <Text style={styles.emoji}>{g.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{g.name}</Text>
                <Text style={styles.desc}>{g.desc}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          ))}
        </View>
        {openGame === 'star' && <StarGame key="star" onClose={() => setOpenGame(null)} />}
        {openGame === 'memory' && <MemoryGame key="memory" onClose={() => setOpenGame(null)} />}
        {openGame === 'jump' && <JumpGame key="jump" onClose={() => setOpenGame(null)} />}
      </ScrollView>
      {ToastView}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Shared result card
// ---------------------------------------------------------------------------

function ResultCard({
  title,
  detail,
  onAgain,
  onBack,
}: {
  title: string;
  detail: string;
  onAgain: () => void;
  onBack: () => void;
}) {
  return (
    <View style={styles.result}>
      <Text style={styles.resultTitle}>{title}</Text>
      <Text style={styles.resultDetail}>{detail}</Text>
      <View style={styles.resultRow}>
        <Pressable style={styles.miniBtn} onPress={onAgain} testID="play-again">
          <Text style={styles.miniBtnText}>↻ Play again</Text>
        </Pressable>
        <Pressable style={styles.miniBtn} onPress={onBack}>
          <Text style={styles.miniBtnText}>Back</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Catch the Star — 8 stars in 15s
// ---------------------------------------------------------------------------

function StarGame({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<'ready' | 'playing' | 'done'>('ready');
  const [caught, setCaught] = useState(0);
  const [left, setLeft] = useState(15);
  const [star, setStar] = useState({ x: 40, y: 40 });
  const [result, setResult] = useState<{ won: boolean; coins: number; happy: number; caught: number } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateRef = useRef({ caught: 0, left: 15 });

  const stop = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => stop, [stop]);

  const spawn = useCallback(() => {
    setStar({ x: 5 + Math.random() * 78, y: 5 + Math.random() * 68 });
  }, []);

  const endGame = useCallback(() => {
    stop();
    const won = stateRef.current.caught >= 8;
    const r = gameReward(won);
    audioPlayer.playSfx(won ? 'win' : 'lose');
    setResult(
      r
        ? { won, coins: r.coins, happy: r.happy, caught: stateRef.current.caught }
        : { won, coins: 0, happy: 0, caught: stateRef.current.caught },
    );
    setPhase('done');
  }, [stop]);

  const start = useCallback(() => {
    stop();
    stateRef.current = { caught: 0, left: 15 };
    setCaught(0);
    setLeft(15);
    setResult(null);
    setPhase('playing');
    spawn();
    timer.current = setInterval(() => {
      stateRef.current.left -= 1;
      setLeft(stateRef.current.left);
      if (stateRef.current.left <= 0) endGame();
    }, 1000);
  }, [endGame, spawn, stop]);

  const catchStar = () => {
    stateRef.current.caught += 1;
    setCaught(stateRef.current.caught);
    audioPlayer.playSfx('tap');
    setStar({ x: -100, y: -100 }); // hide until the next spawn
    setTimeout(spawn, 250);
  };

  return (
    <View style={styles.gameArea} testID="game-star">
      <Text style={styles.gTitle}>⭐ Catch the Star</Text>
      {phase === 'done' && result ? (
        <ResultCard
          title={result.won ? '🎉 You win!' : "⏰ Time's up!"}
          detail={`Caught ${result.caught} / 8 stars. +${result.coins} coins, +${result.happy} happiness.${result.won ? ' Weight −1!' : ''}`}
          onAgain={start}
          onBack={onClose}
        />
      ) : (
        <>
          <Text style={styles.gStatus}>
            Catch <Text style={{ fontWeight: '800' }}>8 stars</Text> in 15 seconds! Each catch: tap the ⭐.
          </Text>
          <Text style={styles.gStatus} testID="star-score">
            Caught: {caught} / 8 · {left}s left
          </Text>
          <View style={styles.starField}>
            {phase === 'playing' && (
              <Pressable
                style={[styles.starBtn, { left: `${star.x}%`, top: `${star.y}%` }]}
                onPress={catchStar}
                testID="star-target"
              >
                <Text style={{ fontSize: 28 }}>⭐</Text>
              </Pressable>
            )}
          </View>
          <View style={styles.row}>
            {phase === 'ready' && (
              <Pressable style={styles.miniBtn} onPress={start} testID="star-start">
                <Text style={styles.miniBtnText}>▶ Start</Text>
              </Pressable>
            )}
            <Pressable style={styles.miniBtn} onPress={() => { stop(); onClose(); }}>
              <Text style={styles.miniBtnText}>✕ Close</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Memory Match — 8 cards, 4 pairs
// ---------------------------------------------------------------------------

const MEMORY_EMOJIS = ['🍡', '🧋', '⭐', '🍓'];

function shuffledDeck(): string[] {
  return [...MEMORY_EMOJIS, ...MEMORY_EMOJIS].sort(() => Math.random() - 0.5);
}

function MemoryGame({ onClose }: { onClose: () => void }) {
  const [deck, setDeck] = useState<string[]>(() => shuffledDeck());
  const [flipped, setFlipped] = useState<number[]>([]);
  const [matched, setMatched] = useState<number[]>([]);
  const [moves, setMoves] = useState(0);
  const [result, setResult] = useState<{ coins: number; happy: number } | null>(null);
  const lock = useRef(false);
  const flipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (flipTimer.current) clearTimeout(flipTimer.current);
    },
    [],
  );

  const reset = useCallback(() => {
    setDeck(shuffledDeck());
    setFlipped([]);
    setMatched([]);
    setMoves(0);
    setResult(null);
    lock.current = false;
  }, []);

  const flip = (idx: number) => {
    if (lock.current || flipped.includes(idx) || matched.includes(idx) || result) return;
    audioPlayer.playSfx('tap');
    const next = [...flipped, idx];
    setFlipped(next);
    if (next.length === 2) {
      setMoves((m) => m + 1);
      const [a, b] = next;
      if (deck[a] === deck[b]) {
        const newMatched = [...matched, a, b];
        setMatched(newMatched);
        setFlipped([]);
        audioPlayer.playSfx('ding');
        if (newMatched.length === 8) {
          const r = gameReward(true);
          audioPlayer.playSfx('win');
          setResult(r ? { coins: r.coins, happy: r.happy } : { coins: 0, happy: 0 });
        }
      } else {
        lock.current = true;
        flipTimer.current = setTimeout(() => {
          setFlipped([]);
          lock.current = false;
        }, 700);
      }
    }
  };

  return (
    <View style={styles.gameArea} testID="game-memory">
      <Text style={styles.gTitle}>🃏 Memory Match</Text>
      {result ? (
        <ResultCard
          title="🎉 All matched!"
          detail={`All matched in ${moves} moves! +${result.coins} coins, +${result.happy} happiness. Weight −1!`}
          onAgain={reset}
          onBack={onClose}
        />
      ) : (
        <>
          <Text style={styles.gStatus}>Find all 4 pairs! Moves: {moves}</Text>
          <View style={styles.memoryGrid}>
            {deck.map((emoji, i) => {
              const faceUp = flipped.includes(i) || matched.includes(i);
              const isMatched = matched.includes(i);
              return (
                <Pressable
                  key={i}
                  style={[styles.memCard, faceUp && styles.memCardUp, isMatched && styles.memCardMatched]}
                  onPress={() => flip(i)}
                  testID={`mem-card-${i}`}
                >
                  <Text style={{ fontSize: 26 }}>{faceUp ? emoji : '❓'}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.row}>
            <Pressable style={styles.miniBtn} onPress={onClose}>
              <Text style={styles.miniBtnText}>✕ Close</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Jump! — clear 8 rocks in 30s
// ---------------------------------------------------------------------------

interface Rock {
  id: number;
  left: number;
}

function JumpGame({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<'ready' | 'playing' | 'done'>('ready');
  const [rocks, setRocks] = useState<Rock[]>([]);
  const [cleared, setCleared] = useState(0);
  const [left, setLeft] = useState(30);
  const [jumping, setJumping] = useState(false);
  const [result, setResult] = useState<{ won: boolean; coins: number; happy: number; cleared: number } | null>(null);
  const game = useRef({
    cleared: 0,
    left: 30,
    jumping: false,
    over: false,
    spawnIn: 0,
    nextId: 1,
    rocks: [] as Rock[],
  });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const jumpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    if (jumpTimer.current) {
      clearTimeout(jumpTimer.current);
      jumpTimer.current = null;
    }
  }, []);

  useEffect(() => stop, [stop]);

  const endGame = useCallback(
    (won: boolean) => {
      if (game.current.over) return;
      game.current.over = true;
      stop();
      const r = gameReward(won);
      audioPlayer.playSfx(won ? 'win' : 'lose');
      setResult({
        won,
        coins: r ? r.coins : 0,
        happy: r ? r.happy : 0,
        cleared: game.current.cleared,
      });
      setPhase('done');
    },
    [stop],
  );

  const start = useCallback(() => {
    stop();
    game.current = { cleared: 0, left: 30, jumping: false, over: false, spawnIn: 0, nextId: 1, rocks: [] };
    setRocks([]);
    setCleared(0);
    setLeft(30);
    setJumping(false);
    setResult(null);
    setPhase('playing');
    timer.current = setInterval(() => {
      const g = game.current;
      if (g.over) return;
      g.left = Math.max(0, g.left - 0.1);
      setLeft(Math.ceil(g.left));
      if (g.left <= 0) {
        endGame(g.cleared >= 8);
        return;
      }
      g.spawnIn -= 100;
      if (g.spawnIn <= 0) {
        g.spawnIn = 1300;
        g.rocks = [...g.rocks, { id: g.nextId++, left: 96 }];
      }
      const nextRocks: Rock[] = [];
      for (const rock of g.rocks) {
        const next = rock.left - 2.5;
        if (next < -4) {
          g.cleared += 1;
          setCleared(g.cleared);
          if (g.cleared >= 8) {
            g.rocks = nextRocks;
            setRocks(nextRocks);
            endGame(true);
            return;
          }
          continue;
        }
        // Collision: rock in the pet zone (6%..18%) while on the ground.
        if (next >= 6 && next <= 18 && !g.jumping) {
          g.rocks = [...nextRocks, { ...rock, left: next }];
          setRocks(g.rocks);
          endGame(false);
          return;
        }
        nextRocks.push({ ...rock, left: next });
      }
      g.rocks = nextRocks;
      setRocks(nextRocks);
    }, 100);
  }, [endGame, stop]);

  const doJump = () => {
    if (phase !== 'playing' || game.current.over) return;
    game.current.jumping = true;
    setJumping(true);
    audioPlayer.playSfx('hop');
    if (jumpTimer.current) clearTimeout(jumpTimer.current);
    jumpTimer.current = setTimeout(() => {
      game.current.jumping = false;
      setJumping(false);
    }, 500);
  };

  return (
    <View style={styles.gameArea} testID="game-jump">
      <Text style={styles.gTitle}>🐰 Jump!</Text>
      {phase === 'done' && result ? (
        <ResultCard
          title={result.won ? '🎉 You win!' : '💥 Ouch!'}
          detail={`${result.won ? 'Cleared 8 rocks!' : `Cleared ${result.cleared} / 8 rocks.`} +${result.coins} coins, +${result.happy} happiness.${result.won ? ' Weight −1!' : ''}`}
          onAgain={start}
          onBack={onClose}
        />
      ) : (
        <>
          <Text style={styles.gStatus}>
            Clear <Text style={{ fontWeight: '800' }}>8 rocks</Text> in 30 seconds! Press JUMP when a rock reaches your pet.
          </Text>
          <Text style={styles.gStatus} testID="jump-score">
            Cleared: {cleared} / 8 · {left}s left
          </Text>
          <View style={styles.jumpField}>
            <Text style={[styles.jumpPet, jumping && styles.jumpPetJumping]}>🐰</Text>
            {rocks.map((rock) => (
              <Text key={rock.id} style={[styles.jumpRock, { left: `${rock.left}%` }]}>
                🪨
              </Text>
            ))}
          </View>
          <View style={styles.row}>
            {phase === 'ready' ? (
              <Pressable style={styles.miniBtn} onPress={start} testID="jump-start">
                <Text style={styles.miniBtnText}>▶ Start</Text>
              </Pressable>
            ) : (
              <Pressable style={styles.miniBtn} onPress={doJump} testID="jump-btn">
                <Text style={styles.miniBtnText}>⬆️ JUMP</Text>
              </Pressable>
            )}
            <Pressable style={styles.miniBtn} onPress={() => { stop(); onClose(); }}>
              <Text style={styles.miniBtnText}>✕ Close</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  list: {
    gap: 8,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#f3c6d3',
    borderRadius: 14,
    padding: 12,
    minHeight: 64,
  },
  emoji: {
    fontSize: 28,
  },
  name: {
    fontWeight: '800',
    color: COLORS.text,
    fontSize: 15,
  },
  desc: {
    fontSize: 12,
    color: COLORS.muted,
    marginTop: 1,
  },
  chevron: {
    fontSize: 22,
    color: COLORS.muted,
  },
  blocked: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#f3c6d3',
    borderRadius: 12,
    padding: 10,
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 10,
    textAlign: 'center',
  },
  gameArea: {
    marginTop: 12,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: COLORS.cardBorder,
    borderRadius: 14,
    padding: 10,
    minHeight: 180,
  },
  gTitle: {
    fontWeight: '800',
    color: COLORS.text,
    fontSize: 15,
    marginBottom: 6,
  },
  gStatus: {
    fontSize: 13,
    color: COLORS.textSoft,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
  },
  miniBtn: {
    borderWidth: 2,
    borderColor: '#f3c6d3',
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.text,
  },
  result: {
    paddingVertical: 8,
  },
  resultTitle: {
    fontWeight: '800',
    color: COLORS.text,
    fontSize: 17,
    marginBottom: 6,
  },
  resultDetail: {
    fontSize: 13,
    color: COLORS.textSoft,
    marginBottom: 10,
  },
  resultRow: {
    flexDirection: 'row',
    gap: 6,
  },
  starField: {
    position: 'relative',
    height: 150,
    backgroundColor: '#fff6ec',
    borderRadius: 10,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#f3c6d3',
    overflow: 'hidden',
  },
  starBtn: {
    position: 'absolute',
    padding: 6,
  },
  memoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  memCard: {
    width: '23%',
    flexGrow: 1,
    aspectRatio: 1,
    borderWidth: 2,
    borderColor: '#f3c6d3',
    borderRadius: 10,
    backgroundColor: COLORS.pinkSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memCardUp: {
    backgroundColor: '#fff',
  },
  memCardMatched: {
    borderColor: '#8fce9b',
    backgroundColor: '#eafaf0',
  },
  jumpField: {
    position: 'relative',
    height: 150,
    backgroundColor: '#fff6ec',
    borderRadius: 10,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#f3c6d3',
    overflow: 'hidden',
  },
  jumpPet: {
    position: 'absolute',
    left: '8%',
    bottom: 6,
    fontSize: 30,
    lineHeight: 34,
  },
  jumpPetJumping: {
    bottom: 62,
  },
  jumpRock: {
    position: 'absolute',
    bottom: 4,
    fontSize: 24,
    lineHeight: 28,
  },
});
