import * as cg from 'chessground/types';
import { parseFen, makeBoardFen } from 'chessops/fen';
import {
  parseSquare,
  makeSquare,
  Piece,
  Chess,
  NormalMove as Move,
  SquareName as Key,
  charToRole,
} from 'chessops';
import { Antichess, Context } from 'chessops/variant';
import { chessgroundDests } from 'chessops/compat';
import { CgMove } from './chessground';
import { makeSan } from 'chessops/san';
import { isRole, oppColor, PromotionChar, PromotionRole } from './util';

type LearnVariant = Chess | Antichess;

export interface ChessCtrl {
  dests(opts?: { illegal?: boolean }): cg.Dests;
  setColor(c: Color): void;
  getColor(): Color;
  fen(): string;
  move(orig: Key, dest: Key, prom?: PromotionRole | PromotionChar | ''): Move | null;
  moves(pos: LearnVariant): Move[];
  occupiedKeys(): Key[];
  kingKey(color: Color): Key | undefined;
  findCapture(): CgMove;
  findUnprotectedCapture(): CgMove | undefined;
  checks(): CgMove[] | undefined;
  playRandomMove(): CgMove | undefined;
  get(square: Key): Piece | undefined;
  instance: LearnVariant;
  sanHistory(): string[];
}

export default function (fen: string, appleKeys: Key[]): ChessCtrl {
  const setup = parseFen(fen).unwrap();
  const chess = Chess.fromSetup(setup);
  // Use antichess when there are less than 2 kings
  const pos = chess.isOk ? chess.unwrap() : Antichess.fromSetup(setup).unwrap();

  // adds enemy pawns on apples, for collisions
  if (appleKeys) {
    const color = pos.turn === 'white' ? 'black' : 'white';
    appleKeys.forEach(key => {
      pos.board.set(parseSquare(key), { color: color, role: 'pawn' });
    });
  }

  const defaultAntichess = Antichess.default();
  const defaultChess = Chess.default();
  const context = (): Context => {
    const king = pos.board.kingOf(pos.turn);
    const occupied = pos.board.occupied;
    return king
      ? {
          blockers: occupied,
          checkers: pos.kingAttackers(king, oppColor(pos.turn), occupied),
          king: king,
          mustCapture: false,
          variantEnd: false,
        }
      : defaultAntichess.ctx();
  };
  if (pos instanceof Antichess) {
    pos.ctx = context;
    pos.kingAttackers = defaultChess.kingAttackers;
  }

  const cloneWithCtx = (pos: LearnVariant): LearnVariant => {
    const clone = pos.clone();
    clone.ctx = pos.ctx;
    clone.kingAttackers = pos.kingAttackers;
    return clone;
  };

  const history: string[] = [];

  const moves = (pos: LearnVariant): Move[] =>
    Array.from(chessgroundDests(pos)).reduce<Move[]>(
      (prev, [orig, dests]) =>
        prev.concat(dests.map((dest): Move => ({ from: parseSquare(orig), to: parseSquare(dest) }))),
      [],
    );

  const findCaptures = (pos: LearnVariant): Move[] => moves(pos).filter(move => pos.board.get(move.to));

  const setColor = (c: Color) => {
    pos.turn = c;
  };

  const moveToCgMove = (move: Move): CgMove => ({ orig: makeSquare(move.from), dest: makeSquare(move.to) });

  return {
    dests: () => chessgroundDests(pos),
    getColor: () => pos.turn,
    setColor: setColor,
    fen: () => makeBoardFen(pos.board),
    moves: moves,
    move: (orig: Key, dest: Key, prom?: PromotionChar | PromotionRole | '') => {
      const move: Move = {
        from: parseSquare(orig),
        to: parseSquare(dest),
        promotion: prom ? (isRole(prom) ? prom : charToRole(prom)) : undefined,
      };
      const clone = cloneWithCtx(pos);
      clone.play(move);
      clone.turn = oppColor(clone.turn);
      history.push(makeSan(pos, move));
      pos.play(move);
      return !clone.isCheck() ? move : null;
    },
    occupiedKeys: () => Array.from(pos.board.occupied).map(s => makeSquare(s)),
    kingKey: (color: Color) => {
      const kingSq = pos.board.kingOf(color);
      return kingSq !== undefined ? makeSquare(kingSq) : undefined;
    },
    findCapture: () => moveToCgMove(findCaptures(pos)[0]),
    findUnprotectedCapture: () => {
      const maybeCapture = findCaptures(pos).find(capture => {
        const clone = cloneWithCtx(pos);
        clone.play({ from: capture.from, to: capture.to });
        return !findCaptures(clone).length;
      });
      return maybeCapture ? moveToCgMove(maybeCapture) : undefined;
    },
    checks: () => {
      if (!pos.isCheck()) return undefined;
      const color = pos.turn;
      setColor(oppColor(color));
      const checks = moves(pos)
        .filter(m => pos.board.get(m.to)?.role == 'king')
        .map(moveToCgMove);
      setColor(color);
      return checks.length == 0 ? undefined : checks;
    },
    playRandomMove: () => {
      const all = moves(pos);
      if (all.length) {
        const move = all[Math.floor(Math.random() * all.length)];
        pos.play(move);
        return moveToCgMove(move);
      }
      return undefined;
    },
    get: (key: Key) => pos.board.get(parseSquare(key)),
    instance: pos,
    sanHistory: () => history,
  };
}
