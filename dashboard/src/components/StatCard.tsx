import { motion } from 'framer-motion';
import { type LucideIcon } from 'lucide-react';
import { cn } from '../utils/cn';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  color: string;
  subvalue?: string;
}

export const StatCard = ({ title, value, icon: Icon, color, subvalue }: StatCardProps) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4 hover:shadow-md transition-all group"
  >
    <div className={cn("p-3 rounded-xl transition-colors", color)}>
      <Icon size={24} className="group-hover:scale-110 transition-transform" />
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate">{title}</p>
      <p className="text-xl font-bold text-slate-900 truncate">{value}</p>
      {subvalue && <p className="text-[10px] text-slate-500 font-medium truncate mt-0.5">{subvalue}</p>}
    </div>
  </motion.div>
);
