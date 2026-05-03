import { useEffect, useState } from 'react';
import { BookOpen, Lightbulb, RefreshCw } from 'lucide-react';
import { apiJson } from '../utils/api';

interface Lesson {
  title: string;
  body: string;
}

export const LessonsPanel = ({ currentProject }: { currentProject: string }) => {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [proposals, setProposals] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    apiJson<{ lessons?: Lesson[]; proposals?: Lesson[] }>(`/lessons?cwd=${encodeURIComponent(currentProject)}&t=${Date.now()}`)
      .then((data) => {
        if (!active) return;
        setLessons(Array.isArray(data.lessons) ? data.lessons : []);
        setProposals(Array.isArray(data.proposals) ? data.proposals : []);
        setLoading(false);
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [currentProject]);

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm lg:col-span-2">
      <div className="mb-6 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-3 text-xl font-black">
          <BookOpen className="text-indigo-500" />
          Lessons & Learning
        </h2>
        {loading && <RefreshCw size={16} className="animate-spin text-slate-400" />}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LessonColumn title="Project Lessons" empty="No saved lessons yet." lessons={lessons} />
        <LessonColumn title="Suggested Rules" empty="No repeated failure proposals yet." lessons={proposals} suggested />
      </div>
    </section>
  );
};

function LessonColumn({
  title,
  empty,
  lessons,
  suggested = false
}: {
  title: string;
  empty: string;
  lessons: Lesson[];
  suggested?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
      <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-slate-400">{title}</p>
      <div className="space-y-3">
        {lessons.length === 0 ? (
          <p className="py-6 text-center text-xs font-bold italic text-slate-400">{empty}</p>
        ) : (
          lessons.map((lesson) => (
            <div key={`${lesson.title}-${lesson.body}`} className="rounded-2xl border border-slate-100 bg-white p-4">
              <div className="mb-2 flex items-center gap-2">
                {suggested && <Lightbulb size={14} className="text-amber-500" />}
                <p className="text-xs font-black uppercase text-slate-800">{lesson.title}</p>
              </div>
              <p className="text-xs font-medium leading-relaxed text-slate-500">{lesson.body}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
