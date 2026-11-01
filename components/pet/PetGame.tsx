// My Monshi: a personal pet to raise, train and talk to. The pet lives on this device; a wallet is only needed to buy supplies with MONSHI.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAccount, usePublicClient, useSignMessage, useWriteContract } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { parseAbi, type Address } from 'viem';
import { PET, type Cosmetic, type Food, type NeedKey, type SkillKey, type StageId } from '@/lib/pet/config';
import { PREMIUM, type PremiumItem } from '@/lib/pet/shop';
import { play, setSound, soundOn } from '@/lib/pet/sound';
import { disablePush, enablePush, pushConfigured, pushEnabled, pushSupported, reschedulePush } from '@/lib/pet/reminder';
import { studioSig, postJson } from '@/lib/launchClient';
import { isAdmin } from '@/lib/constants';
import { applyPurchases, canTalk, canTrain, claimDaily, dailyClaimed, feed, finishPlay, finishTrain, moodOf, skillNeed, sleep, SKILL_KEYS, stageOf, talk, talksToday, tick, toggleCosmetic, wake, wash, type Pet } from '@/lib/pet/game';
import { loadPet, resetPet, savePet } from '@/lib/pet/storage';
import Drill from './Drill';
import PetStageView, { type Fx, type Pose } from './PetStageView';

type Tab = 'home' | 'talk' | 'train' | 'room' | 'help';
const NEEDS: { key: NeedKey; label: string; icon: string; color: string }[] = [
  { key: 'hunger', label: 'Hunger', icon: '🍗', color: '#f2b45f' }, { key: 'happiness', label: 'Happy', icon: '💜', color: '#d59af5' },
  { key: 'energy', label: 'Energy', icon: '⚡', color: '#f5d46b' }, { key: 'cleanliness', label: 'Clean', icon: '🫧', color: '#82d7e8' },
];
const SKILLS: Record<SkillKey, { label: string; icon: string; task: string; desc: string; kind: 'tap' | 'memory' | 'beat'; target: number }> = {
  speed: { label: 'Speed', icon: '💨', task: 'Paw Sprint', desc: 'Tap fast to dash.', kind: 'tap', target: PET.train.targetTaps },
  strength: { label: 'Strength', icon: '💪', task: 'Power Paws', desc: 'Tap to lift the weights.', kind: 'tap', target: PET.train.targetTaps },
  brains: { label: 'Brains', icon: '🧠', task: 'Memory Match', desc: 'Repeat the light sequence.', kind: 'memory', target: 5 },
  charm: { label: 'Charm', icon: '✨', task: 'Sweet Talk', desc: 'Tap when the beat hits gold.', kind: 'beat', target: 8 },
};
const SAY: Record<string, string[]> = {
  happy: ['Lookin’ sharp. That’s because of me.', 'We make a good team. Don’t get mushy.', 'You bring snacks, I bring the attitude.', 'Not bad, human. Not bad at all.'],
  ok: ['What’s the plan, boss?', 'A little training never hurt anybody.', 'I was totally not napping.', 'Let’s keep the paws moving.'],
  hungry: ['Milk. Now. Please. I said please.', 'I can hear the snack cupboard calling.', 'A hungry Monshi is a dramatic Monshi.'],
  sleepy: ['Five more minutes. Firm offer.', 'My eyes are buffering.', 'Even legends need a nap.'],
  dirty: ['I smell like a training montage.', 'Bath time? I was hoping you’d forget.', 'I am not messy. I’m rugged.'],
  sad: ['Hey. We all have off days.', 'Stick around? That helps more than snacks.', 'One small win. Let’s start there.'],
  sulking: ['Hmph. Took you long enough. …Missed you.', 'I wasn’t worried. Maybe a little.', 'The room was too quiet without you.'],
};
const pick = (mood: string, seed: number) => { const a = SAY[mood] || SAY.ok; return a[(Math.floor(Date.now() / 60_000) + seed) % a.length]; };
const erc20 = parseAbi(['function transfer(address to, uint256 amount) returns (bool)']);
const MONSHI = '0xB744F5CDb792d8187640214C4A1c9aCE29af7777' as Address;
const fmtM = (n: number) => (n >= 1e6 ? `${n / 1e6}M` : `${n / 1e3}K`);

export default function PetGame() {
  const [pet, setPet] = useState<Pet | null>(null);
  const [tab, setTab] = useState<Tab>('home');
  const [toast, setToast] = useState('');
  const [drill, setDrill] = useState<null | { play: true } | { skill: SkillKey }>(null);
  const [now, setNow] = useState(Date.now());
  const [action, setAction] = useState<'eat' | 'wash' | null>(null);
  const [fx, setFx] = useState<Fx>(null);
  const [said, setSaid] = useState('');
  const poseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const burst = useCallback((emoji: string, n = 3) => setFx({ key: Date.now() + Math.random(), emoji, n }), []);
  const doPose = useCallback((a: 'eat' | 'wash', ms: number, emoji: string) => { setAction(a); burst(emoji, 3); if (poseTimer.current) clearTimeout(poseTimer.current); poseTimer.current = setTimeout(() => setAction(null), ms); }, [burst]);
  const sayLine = useCallback((line: string) => { setSaid(line); setTimeout(() => setSaid(''), 4500); }, []);

  useEffect(() => { setPet(loadPet()); }, []);
  useEffect(() => { if (pet) savePet(pet); }, [pet]);
  const lastStage = useRef<StageId | null>(null);
  useEffect(() => { if (!pet) return; const st = stageOf(pet); if (lastStage.current && lastStage.current !== st) { play('levelup'); burst('✨', 6); setToast(`Monshi grew into a ${PET.stages.find((x) => x.id === st)!.label}!`); } lastStage.current = st; }, [pet]);
  useEffect(() => { if (!pet) return; const id = setTimeout(() => void reschedulePush(pet), 4000); return () => clearTimeout(id); }, [pet]);
  useEffect(() => { const id = setInterval(() => { setNow(Date.now()); setPet((p) => (p ? tick(p) : p)); }, 15_000); return () => clearInterval(id); }, []);

  const act = useCallback((fn: (p: Pet) => Pet, msg?: string, sfx?: Parameters<typeof play>[0]) => { setPet((p) => (p ? fn(tick(p)) : p)); if (msg) setToast(msg); if (sfx) play(sfx); }, []);
  const mood = pet ? moodOf(pet, now) : 'ok';
  const stage = pet ? stageOf(pet) : 'kit';
  const stageInfo = PET.stages.find((s) => s.id === stage)!;
  const nextStage = PET.stages.find((s) => pet && s.from > pet.points);
  const avgLevel = useMemo(() => (pet ? Math.round(SKILL_KEYS.reduce((a, k) => a + pet.skills[k].level, 0) / 4) : 1), [pet]);

  if (!pet) return <div className="grid min-h-[60vh] place-items-center text-purple-100/70">Waking up Monshi…</div>;
  const asleep = !!pet.sleepingUntil;
  const mins = asleep ? Math.max(1, Math.ceil((pet.sleepingUntil! - now) / 60_000)) : 0;
  const sprite = `/pet/${stage}-${mood}.webp`;

  return (
    <main className="pet mx-auto max-w-[520px] px-3 pb-24 pt-4">
      <header className="mb-3 flex items-center justify-between">
        <div><div className="text-[11px] font-black uppercase tracking-[.25em] text-purple-200/70">A tiny daily adventure</div><h1 className="text-2xl font-black">My <span className="text-purple-300">Monshi</span></h1></div>
        <div className="flex gap-1 text-sm font-black" aria-label="Supplies">{(Object.keys(PET.foods) as Food[]).map((f) => <span key={f} className={`rounded-xl px-2 py-2 ${pet.inventory[f] === 0 ? "bg-red-500/25" : "bg-white/10"}`}>{PET.foods[f].icon} {pet.inventory[f]}</span>)}</div>
      </header>
      <nav className="mb-3 grid grid-cols-5 gap-1 rounded-2xl border border-white/10 bg-black/20 p-1" aria-label="Pet sections">
        {([['home', '🏠', 'Home'], ['talk', '💬', 'Talk'], ['train', '🏋️', 'Train'], ['room', '🛋️', 'Room'], ['help', '📖', 'Help']] as [Tab, string, string][]).map(([id, icon, label]) => (
          <button key={id} type="button" onClick={() => { setTab(id); setToast(''); }} className={`rounded-xl py-2 text-[11px] font-bold ${tab === id ? 'bg-purple-500/40 text-white' : 'text-purple-100/60'}`}><span className="block text-lg">{icon}</span>{label}</button>
        ))}
      </nav>
      {toast && <button type="button" onClick={() => setToast('')} className="mb-3 w-full rounded-xl border border-purple-300/20 bg-purple-400/10 px-3 py-2 text-left text-xs">{toast}<span className="float-right">✕</span></button>}

      {tab === 'home' && (
        <>
          <section className="relative overflow-hidden rounded-[28px] border border-purple-300/15 bg-gradient-to-b from-[#3a2260] to-[#1b1030] px-4 pb-4 pt-3">
            <div className="flex items-center justify-between text-xs"><div><div className="text-[10px] font-black uppercase tracking-[.2em] text-purple-200/70">{stageInfo.room} · {stageInfo.label}</div><div className="text-sm font-bold">Hey, boss.</div></div><div className="rounded-xl bg-white/10 px-3 py-2">🔥 {pet.streak} day streak</div></div>
            <PetStageView stage={stage} mood={mood} pose={(asleep ? 'sleep' : action) as Pose} equipped={pet.equipped} fx={fx} onPoke={(line) => { sayLine(line); play('tap'); }} />
            <div className="mx-auto max-w-[340px] rounded-2xl border border-purple-200/15 bg-[#1a1026]/85 px-4 py-3 text-center">
              <div className="mb-1 text-[9px] font-black uppercase tracking-[.22em] text-purple-200/60">MONSHI SAYS</div>
              <p className="text-sm font-bold leading-snug">“{asleep ? 'Zzz… five more minutes…' : said || pick(mood, avgLevel)}”</p>
            </div>
            {asleep && (
              <div className="mt-2 flex items-center justify-between rounded-2xl bg-black/40 px-4 py-2 text-xs"><span>💤 Lights out. Wakes in about {mins} min.</span><button type="button" onClick={() => act((p) => wake(p), 'Good morning!', 'good')} className="rounded-xl bg-purple-500 px-3 py-1 font-bold">Wake him up</button></div>
            )}
          </section>

          <section className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-black">Care check</h2><span className="text-[10px] text-purple-200/60">{nextStage ? `${nextStage.from - pet.points} points to ${nextStage.label}` : 'Max stage'}</span></div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {NEEDS.map((n) => (
                <div key={n.key}><div className="mb-1 flex justify-between text-xs"><span>{n.icon} {n.label}</span><b>{Math.round(pet.needs[n.key])}</b></div><div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full" style={{ width: `${pet.needs[n.key]}%`, background: n.color }} /></div></div>
              ))}
            </div>
          </section>

          <section className="mt-3 grid grid-cols-2 gap-2">
            {(Object.keys(PET.foods) as Food[]).slice(0, 2).map((f) => (
              <button key={f} type="button" disabled={asleep || pet.inventory[f] === 0} onClick={() => { act((p) => feed(p, f), f === 'milk' ? 'Milk time. His favourite!' : 'Crunch. Excellent choice.', 'feed'); doPose('eat', 2600, PET.foods[f].icon); }} className="rounded-2xl bg-purple-500/30 p-3 text-left disabled:opacity-40"><div className="text-2xl">{PET.foods[f].icon}</div><div className="font-black">Feed {PET.foods[f].label.toLowerCase()}</div><div className="text-[10px] text-purple-100/70">{pet.inventory[f]} left</div></button>
            ))}
            <button type="button" disabled={asleep} onClick={() => setDrill({ play: true })} className="rounded-2xl bg-white/10 p-3 text-left disabled:opacity-40"><div className="text-2xl">🎾</div><div className="font-black">Play together</div><div className="text-[10px] text-purple-100/70">{PET.play.seconds}-second tap game</div></button>
            <button type="button" disabled={asleep} onClick={() => { act((p) => wash(p), 'Fresh and fluffy.', 'good'); doPose('wash', 3000, '🫧'); }} className="rounded-2xl bg-white/10 p-3 text-left disabled:opacity-40"><div className="text-2xl">🫧</div><div className="font-black">Wash</div><div className="text-[10px] text-purple-100/70">+{PET.wash.cleanliness} clean</div></button>
          </section>

          <section className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between"><div><h2 className="font-black">Nap time</h2><p className="text-xs text-purple-100/60">Rest restores energy, even while you’re away.</p></div><span className="text-3xl">🌙</span></div>
            <div className="mt-3 flex gap-2">{PET.sleep.options.map((m) => <button key={m} type="button" disabled={asleep} onClick={() => act((p) => sleep(p, m), `Lights out for ${m} minutes.`, 'nap')} className="flex-1 rounded-xl bg-white/10 py-2 text-sm font-bold disabled:opacity-40">{m} min</button>)}</div>
          </section>

          <section className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between"><div><h2 className="font-black">Daily treat</h2><p className="text-xs text-purple-100/60">One free milk each day. Keep your streak going.</p></div><span className="text-3xl">🎁</span></div>
            <button type="button" disabled={dailyClaimed(pet, now)} onClick={() => { act((p) => claimDaily(p), 'Daily treat claimed!', 'coin'); burst('🎁', 4); }} className="mt-3 w-full rounded-xl bg-purple-500 py-3 font-black disabled:opacity-40">{dailyClaimed(pet, now) ? 'Come back tomorrow' : 'Claim daily treat'}</button>
          </section>
        </>
      )}

      {tab === 'talk' && <TalkTab pet={pet} mood={mood} stage={stage} onSpend={() => act((p) => talk(p), undefined, 'tap')} onToast={setToast} />}

      {tab === 'train' && (
        <section className="space-y-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4"><h2 className="text-xl font-black">Training yard</h2><p className="mt-1 text-sm text-purple-100/70">Each drill takes about {PET.train.seconds} seconds, costs {PET.train.energyCost} energy, then cools down for {PET.train.cooldownMinutes} minutes.</p></div>
          {SKILL_KEYS.map((k) => {
            const s = SKILLS[k], lv = pet.skills[k], need = skillNeed(lv.level), why = canTrain(pet, k, now);
            return (
              <div key={k} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between"><div><div className="font-black">{s.icon} {s.label} <span className="text-purple-300">Lv {lv.level}</span></div><div className="text-xs text-purple-100/60">{s.task}: {s.desc}</div></div>
                  <button type="button" onClick={() => (why ? setToast(why) : setDrill({ skill: k }))} className={`rounded-xl px-4 py-2 text-sm font-bold ${why ? 'bg-white/10 text-white/50' : 'bg-purple-500'}`}>Train</button></div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-purple-300" style={{ width: `${lv.level >= PET.level.max ? 100 : (lv.xp / need) * 100}%` }} /></div>
              </div>
            );
          })}
        </section>
      )}

      {tab === 'room' && (
        <section className="space-y-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4"><h2 className="text-xl font-black">Wardrobe</h2><p className="text-xs text-purple-100/60">Things you own. Tap to wear or take off.</p>
            {pet.owned.length === 0 ? <p className="mt-3 text-sm text-purple-100/60">Nothing yet. Buy something in the shop below.</p> : (
              <div className="mt-3 grid grid-cols-3 gap-2">{pet.owned.map((c) => { const on = pet.equipped.includes(c); return (
                <button key={c} type="button" onClick={() => act((p) => toggleCosmetic(p, c), undefined, 'tap')} className={`rounded-xl p-3 text-center ${on ? 'bg-purple-500/50' : 'bg-white/10'}`}><img src={`/pet/items/${c}.webp`} alt="" className="mx-auto h-12 w-auto object-contain" /><div className="mt-1 text-xs font-bold">{PET.cosmetics[c].label}</div><div className="text-[10px]">{on ? 'Wearing' : 'Tap to wear'}</div></button>); })}</div>
            )}</div>
          <PremiumShop pet={pet} onBought={(purchases) => act((p) => applyPurchases(p, purchases), 'Thanks! Your MONSHI purchase is in.', 'levelup')} />
        </section>
      )}

      {tab === 'help' && <HelpTab pet={pet} onReset={() => { setPet(resetPet()); setToast('Fresh start.'); }} onApply={(purchases) => act((p) => applyPurchases(p, purchases))} />}

      {drill && 'play' in drill && <Drill kind="tap" seconds={PET.play.seconds} target={PET.play.targetTaps} title="Play time" hint="Tap as fast as you can!" onCancel={() => setDrill(null)} onDone={(sc) => { act((p) => finishPlay(p, sc), `Score ${sc}. Monshi had a blast.`, sc >= 40 ? 'good' : 'sad'); burst(sc >= 40 ? '⭐' : '💦', 5); setDrill(null); }} />}
      {drill && 'skill' in drill && (() => { const s = SKILLS[drill.skill]; return <Drill kind={s.kind} seconds={PET.train.seconds} target={s.target} title={`${s.label} · ${s.task}`} hint={s.desc} onCancel={() => setDrill(null)} onDone={(sc) => { const before = pet.skills[drill.skill].level; act((p) => finishTrain(p, drill.skill, sc), `${s.label} training: score ${sc}.`, sc >= 40 ? 'good' : 'sad'); setTimeout(() => setPet((p) => { if (p && p.skills[drill.skill].level > before) { play('levelup'); setToast(`${s.label} reached level ${p.skills[drill.skill].level}!`); } return p; }), 50); setDrill(null); }} />; })()}
    </main>
  );
}

function PremiumShop({ pet, onBought }: { pet: Pet; onBought: (purchases: { item: string; tx_hash: string }[]) => void }) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { signMessageAsync } = useSignMessage();
  const [info, setInfo] = useState<{ open: boolean; treasury: string | null; purchases: { item: string; tx_hash: string }[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    fetch(`/api/pet/shop${address ? `?wallet=${address}` : ''}`).then((r) => r.json()).then((d) => { setInfo(d); if (address && d.purchases?.length) onBought(d.purchases); }).catch(() => setInfo({ open: false, treasury: null, purchases: [] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  async function buy(item: PremiumItem) {
    if (!address || !publicClient || !info?.treasury) return;
    setMsg(''); setBusy(item);
    try {
      const hash = await writeContractAsync({ address: MONSHI, abi: erc20, functionName: 'transfer', args: [info.treasury as Address, BigInt(PREMIUM[item].priceMonshi) * 10n ** 18n] } as any);
      setMsg('Payment sent. Waiting for it to confirm…');
      const rc = await publicClient.waitForTransactionReceipt({ hash });
      if (rc.status !== 'success') throw new Error('The payment failed.');
      const signature = await studioSig(address, signMessageAsync as any);
      await postJson('/api/pet/shop', { wallet: address, signature, txHash: hash, item });
      const d = await (await fetch(`/api/pet/shop?wallet=${address}`)).json();
      setInfo(d); onBought(d.purchases); setMsg('Done! Your item is unlocked.');
    } catch (e: any) { setMsg(String(e?.shortMessage || e?.message || 'Something went wrong.').slice(0, 140)); } finally { setBusy(null); }
  }

  async function grant(item: PremiumItem) {
    if (!address) return;
    setMsg(''); setBusy(item);
    try {
      const signature = await studioSig(address, signMessageAsync as any);
      await postJson('/api/pet/shop', { wallet: address, signature, item, action: 'grant' });
      const d = await (await fetch(`/api/pet/shop?wallet=${address}`)).json();
      setInfo(d); onBought(d.purchases); setMsg('Test item unlocked (free, admin only).');
    } catch (e: any) { setMsg(String(e?.message || 'Could not unlock.').slice(0, 140)); } finally { setBusy(null); }
  }

  const have = (item: PremiumItem) => (PREMIUM[item].kind === 'cosmetic' ? pet.owned.includes(item as Cosmetic) : false);
  const stock = (item: PremiumItem) => { const d = PREMIUM[item]; return d.kind === 'food' ? ` · have ${pet.inventory[d.food]}` : ''; };
  return (
    <div className="rounded-2xl border border-yellow-300/20 bg-yellow-300/5 p-4">
      <h2 className="font-black">Shop · pay with MONSHI</h2>
      <p className="text-xs text-purple-100/60">Food and outfits are paid from your wallet on this site. He eats about two snacks a day, and the daily treat covers one.</p>
      {!info ? <p className="mt-3 text-xs text-purple-100/50">Loading…</p> : !info.open ? <p className="mt-3 text-xs text-yellow-200/80">The MONSHI shop is not open yet.</p> : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {(Object.keys(PREMIUM) as PremiumItem[]).map((item) => (
              <div key={item} className="rounded-xl bg-white/10 p-3 text-center">
                {PREMIUM[item].kind === 'cosmetic' ? <img src={`/pet/items/${item}.webp`} alt="" className="mx-auto h-12 w-auto object-contain" /> : <div className="text-3xl">{PREMIUM[item].icon}</div>}
                <div className="mt-1 text-xs font-bold">{PREMIUM[item].label}</div>
                <div className="text-[10px] text-purple-100/70">{fmtM(PREMIUM[item].priceMonshi)} MONSHI{stock(item)}</div>
                {have(item) ? <div className="mt-1 text-[10px] font-bold text-green-300">Owned</div> : (
                  <button type="button" disabled={!address || !!busy} onClick={() => void buy(item)} className="mt-2 w-full rounded-lg bg-yellow-400/80 py-1 text-[11px] font-black text-black disabled:opacity-40">{busy === item ? '…' : 'Buy'}</button>
                )}
                {isAdmin(address) && !have(item) && <button type="button" disabled={!!busy} onClick={() => void grant(item)} className="mt-1 w-full rounded-lg bg-white/15 py-1 text-[10px] font-bold">Test: unlock free</button>}
                {isAdmin(address) && have(item) && <div className="mt-1 text-[9px] text-purple-100/40">(admin test)</div>}
              </div>
            ))}
          </div>
          {!address && <div className="mt-3 flex justify-center"><ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" /></div>}
        </>
      )}
      {msg && <p className="mt-2 text-xs text-purple-100/80" role="status">{msg}</p>}
    </div>
  );
}

function HelpTab({ pet, onReset, onApply }: { pet: Pet; onReset: () => void; onApply: (p: { item: string; tx_hash: string }[]) => void }) {
  const [sound, setSoundState] = useState(false);
  const [push, setPush] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => { setSoundState(soundOn()); setPush(pushEnabled()); }, []);
  void onApply;
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  async function testPush() {
    try {
      const reg = await navigator.serviceWorker.getRegistration('/pet'); const sub = await reg?.pushManager.getSubscription();
      if (!sub) { setNote('Turn Reminders on first.'); return; }
      const signature = await studioSig(address!, signMessageAsync as any);
      await postJson('/api/pet/push-test', { wallet: address, signature, subscription: sub.toJSON() });
      setNote('Test sent. It should arrive in a few seconds.');
    } catch (e: any) { setNote(String(e?.message || 'Could not send.').slice(0, 120)); }
  }
  return (
    <section className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-purple-100/80">
      <h2 className="text-xl font-black text-white">How to play</h2>
      <p>Look after your little wolf-cat. Hunger, happiness, energy and cleanliness slowly drop in real time, even while you are away. Feed, play, wash and nap to keep them up.</p>
      <p>Train Speed, Strength, Brains and Charm to level him up. Care and training earn points that grow him through four stages: Kit, Teen, Adult and Legend.</p>
      <p>Claim your daily treat to build a streak, and talk to him in the Talk tab. If you vanish for a day he will sulk, but he never dies.</p>
      <p>Snacks run out, so he needs supplies. The daily treat gives one milk; the shop sells more for MONSHI.</p>
      <div className="flex items-center justify-between rounded-xl bg-white/5 p-3"><div><b className="text-white">Sound effects</b><div className="text-xs text-purple-100/60">Little beeps and bloops.</div></div>
        <button type="button" onClick={() => { const on = !sound; setSound(on); setSoundState(on); if (on) play('good'); }} className={`rounded-full px-4 py-1 text-xs font-bold ${sound ? 'bg-purple-500' : 'bg-white/10'}`}>{sound ? 'On' : 'Off'}</button></div>
      <div className="rounded-xl bg-white/5 p-3"><div className="flex items-center justify-between"><div><b className="text-white">Reminders</b><div className="text-xs text-purple-100/60">A nudge when he is hungry or misses you. At most twice a day.</div></div>
        <button type="button" onClick={async () => { if (push) { await disablePush(); setPush(false); setNote('Reminders are off.'); } else { const err = await enablePush(pet); setPush(!err); setNote(err ?? 'Reminders are on.'); } }} disabled={!pushSupported() || !pushConfigured()} className={`rounded-full px-4 py-1 text-xs font-bold disabled:opacity-40 ${push ? 'bg-purple-500' : 'bg-white/10'}`}>{push ? 'On' : 'Off'}</button></div>
        {!pushConfigured() && <div className="mt-2 text-[11px] text-yellow-200/80">Reminders are not switched on for this site yet.</div>}
        {pushConfigured() && !pushSupported() && <div className="mt-2 text-[11px] text-yellow-200/80">This browser can&apos;t do reminders. On iPhone, add the site to your Home Screen first.</div>}
        {isAdmin(address) && push && <button type="button" onClick={() => void testPush()} className="mt-2 rounded-lg bg-white/15 px-3 py-1 text-[11px] font-bold">Admin: send me a test notification</button>}
        {note && <div className="mt-2 text-[11px]" role="status">{note}</div>}</div>
      <p className="text-xs text-purple-100/50">Your pet is saved on this device. Only buying supplies needs a wallet.</p>
      <button type="button" onClick={() => { if (confirm('Reset Monshi and start over?')) onReset(); }} className="rounded-xl bg-red-500/20 px-4 py-2 font-bold text-red-200">Reset pet</button>
    </section>
  );
}

type Msg = { role: 'user' | 'assistant'; content: string };
const TALK_KEY = 'monshi-pet-talk';

function TalkTab({ pet, mood, stage, onSpend, onToast }: { pet: Pet; mood: string; stage: string; onSpend: () => void; onToast: (m: string) => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { try { setMsgs(JSON.parse(localStorage.getItem(TALK_KEY) || '[]')); } catch { setMsgs([]); } }, []);
  useEffect(() => { try { localStorage.setItem(TALK_KEY, JSON.stringify(msgs.slice(-20))); } catch { /* ignore */ } end.current?.scrollIntoView({ block: 'nearest' }); }, [msgs]);

  const left = Math.max(0, PET.talk.freePerDay - talksToday(pet));
  const blocked = canTalk(pet);
  async function send() {
    const message = text.trim();
    if (!message || busy) return;
    if (blocked) { onToast(blocked); return; }
    setText(''); setBusy(true);
    const next = [...msgs, { role: 'user' as const, content: message }];
    setMsgs(next);
    try {
      const r = await fetch('/api/pet/talk', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, history: msgs.slice(-6), pet: { stage, mood, needs: pet.needs, food: pet.inventory, streak: pet.streak, level: Math.round(SKILL_KEYS.reduce((a, k) => a + pet.skills[k].level, 0) / 4) } }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'No answer.');
      setMsgs([...next, { role: 'assistant', content: d.reply }]); onSpend(); play('tap');
    } catch (e: any) { setMsgs(msgs); setText(message); onToast(e?.message || 'Monshi did not answer.'); } finally { setBusy(false); }
  }
  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between"><h2 className="text-xl font-black">Talk to Monshi</h2><span className="text-[11px] text-purple-100/60">{left > 0 ? `${left} free chats left today` : `1 ${PET.talk.extraCost} per chat now`}</span></div>
      <div className="mt-3 max-h-[46vh] min-h-[160px] space-y-2 overflow-y-auto" aria-live="polite">
        {msgs.length === 0 && <p className="text-sm text-purple-100/60">Say hi. Ask about his day, his training, or just chat. Chatting cheers him up.</p>}
        {msgs.map((m, i) => <div key={i} className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.role === 'user' ? 'ml-auto bg-purple-500/40' : 'bg-white/10'}`}>{m.content}</div>)}
        {busy && <div className="max-w-[60%] rounded-2xl bg-white/10 px-3 py-2 text-sm text-purple-100/60">Monshi is thinking…</div>}
        <div ref={end} />
      </div>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <input value={text} onChange={(e) => setText(e.target.value.slice(0, 200))} placeholder="Say something…" aria-label="Message to Monshi" className="min-w-0 flex-1 rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm" />
        <button type="submit" disabled={busy || !text.trim()} className="rounded-xl bg-purple-500 px-4 py-2 text-sm font-bold disabled:opacity-40">Send</button>
      </form>
      {blocked && <p className="mt-2 text-[11px] text-yellow-200/80">{blocked}</p>}
    </section>
  );
}
