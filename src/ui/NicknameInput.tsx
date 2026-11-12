import { useRef, useState, type FormEvent } from 'react';
import { Check, SkipForward } from 'lucide-react';
import {
  loadLastNickname,
  normalizeNicknameDraft,
  sanitizeNickname,
} from '../game/leaderboard/nickname.ts';
import { GAME_CONFIG } from '../game/rules/gameConfig.ts';

interface NicknameInputProps {
  rank: number;
  onSubmit: (nickname: string) => void;
  onSkip: () => void;
}

export function NicknameInput({ rank, onSubmit, onSkip }: NicknameInputProps) {
  const [value, setValue] = useState<string>(() => loadLastNickname());
  const isComposingRef = useRef(false);

  const maxLen = GAME_CONFIG.leaderboard.maxNicknameLength;
  const previewLen = normalizeNicknameDraft(value).length;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(sanitizeNickname(value));
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 rounded-lg bg-slate-800/75 border border-amber-400/40 p-3 text-left"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs sm:text-sm font-extrabold text-amber-200">
          순위표 {rank}위 진입! 닉네임을 등록하세요
        </span>
        <span className="font-mono-num text-[11px] font-bold text-slate-400">
          {previewLen}/{maxLen}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        <input
          type="text"
          value={value}
          maxLength={24}
          autoComplete="off"
          placeholder={`예: ${GAME_CONFIG.leaderboard.defaultNickname} (최대 ${maxLen}자)`}
          aria-label="순위표 닉네임 입력"
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={(e) => {
            isComposingRef.current = false;
            setValue(normalizeNicknameDraft(e.currentTarget.value));
          }}
          onChange={(e) => {
            const raw = e.target.value;
            if (isComposingRef.current) {
              setValue(raw);
            } else {
              setValue(normalizeNicknameDraft(raw));
            }
          }}
          onBlur={() => {
            setValue((prev) => normalizeNicknameDraft(prev));
          }}
          className="flex-1 min-w-0 min-h-11 rounded-lg bg-slate-950/90 border border-white/20 px-3 text-sm font-bold text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
        />

        <button
          type="submit"
          className="min-h-11 px-3.5 rounded-lg bg-amber-400 hover:bg-amber-300 active:bg-amber-500 text-slate-950 text-xs sm:text-sm font-black flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
        >
          <Check className="w-4 h-4 shrink-0" />
          <span>등록</span>
        </button>

        <button
          type="button"
          onClick={onSkip}
          title="기본 닉네임(갈매기)으로 등록"
          className="min-h-11 px-3 rounded-lg bg-slate-700/90 hover:bg-slate-600 border border-white/15 text-xs font-bold text-slate-200 flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
        >
          <SkipForward className="w-3.5 h-3.5 shrink-0" />
          <span>건너뛰기</span>
        </button>
      </div>

      <p className="mt-1.5 text-[11px] text-slate-400">
        실명이나 연락처는 쓰지 마세요 · 한글·영문·숫자만 최대 8자 (빈칸 시 기본 ‘갈매기’)
      </p>
    </form>
  );
}
