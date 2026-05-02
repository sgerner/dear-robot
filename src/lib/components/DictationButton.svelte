<script lang="ts">
  import { Mic, Square as StopIcon } from 'lucide-svelte';

  type ToggleHandler = (targetId: string) => void | Promise<void>;

  let {
    targetId,
    activeTargetId = null,
    recording = false,
    unavailable = false,
    level = 0,
    onToggle,
    label = 'Voice input',
    className = ''
  } = $props<{
    targetId: string;
    activeTargetId?: string | null;
    recording?: boolean;
    unavailable?: boolean;
    level?: number;
    onToggle: ToggleHandler;
    label?: string;
    className?: string;
  }>();

  const active = $derived(recording && activeTargetId === targetId);
  const intensity = $derived(Math.max(0, Math.min(1, level)));
  const glowOpacity = $derived(0.28 + intensity * 0.92);
  const glowScale = $derived(1.16 + intensity * 0.56);
  const glowBlur = $derived(8 + intensity * 18);
  const glowSpread = $derived(16 + intensity * 28);
  const glowDistance = $derived(14 + intensity * 28);
  const pulseDuration = $derived(`${Math.max(260, 720 - intensity * 360)}ms`);
</script>

<span class="relative inline-flex overflow-visible isolate">
  {#if active}
    <span
      class="pointer-events-none absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full dictation-outer-glow"
      style={`opacity:${glowOpacity}; transform: translate(-50%, -50%) scale(${glowScale}); filter: blur(${glowBlur}px);`}
    ></span>
    <span
      class="pointer-events-none absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border border-red-100/90 dictation-middle-ring"
      style={`opacity:${0.52 + intensity * 0.46}; transform: translate(-50%, -50%) scale(${1 + intensity * 0.28}); box-shadow: 0 0 ${glowSpread}px rgba(248,113,113,${0.3 + intensity * 0.4});`}
    ></span>
    <span
      class="pointer-events-none absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.55)_0%,rgba(248,113,113,0.92)_18%,rgba(248,113,113,0.5)_42%,transparent_75%)]"
      style={`opacity:${0.38 + intensity * 0.62}; transform: translate(-50%, -50%) scale(${1 + intensity * 0.16}); filter: blur(${3 + intensity * 8}px);`}
    ></span>
  {/if}
  <button
    type="button"
    class={`relative z-10 inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-visible rounded-md border text-zinc-300 transition hover:bg-white/[0.06] hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 ${active ? 'border-red-200/90 bg-red-500/20 text-red-50 shadow-[0_0_22px_rgba(248,113,113,0.9)]' : 'border-white/10 bg-white/[0.03]'} ${className}`}
    disabled={unavailable || (recording && !active)}
    aria-label={active ? 'Stop transcription' : label}
    title={active ? 'Stop transcription' : label}
    aria-pressed={active}
    style={active
      ? `box-shadow:
          0 0 ${glowDistance}px rgba(248, 113, 113, ${glowOpacity}),
          0 0 ${Math.max(18, glowDistance - 2)}px rgba(255, 255, 255, ${0.18 + intensity * 0.34}),
          0 0 0 1px rgba(248, 113, 113, ${0.48 + intensity * 0.32});
         animation: dictation-button-breathe ${pulseDuration} ease-in-out infinite;`
      : ''}
    onclick={() => onToggle(targetId)}
  >
    {#if active}
      <span class="absolute inset-0 rounded-md bg-red-400/10"></span>
      <span class="absolute inset-[-1px] rounded-md border border-red-100/40 dictation-core-ring"
      ></span>
      <StopIcon size={14} class="relative z-20" />
    {:else}
      <Mic size={14} />
    {/if}
  </button>
</span>

<style>
  .dictation-outer-glow,
  .dictation-middle-ring {
    transition:
      opacity 45ms linear,
      transform 45ms linear,
      filter 45ms linear,
      box-shadow 45ms linear;
  }

  .dictation-core-ring {
    animation: dictation-core-ring 780ms ease-in-out infinite;
  }

  @keyframes dictation-core-ring {
    0%,
    100% {
      opacity: 0.42;
      transform: scale(1);
    }

    50% {
      opacity: 1;
      transform: scale(1.18);
    }
  }

  @keyframes dictation-button-breathe {
    0%,
    100% {
      transform: translateY(0) scale(1);
    }

    50% {
      transform: translateY(-1px) scale(1.04);
    }
  }
</style>
