/**
 * Persistent Environment Header Indicator
 * Single prominent indicator: Sample Data · Preview Mode
 */

import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faDatabase,
  faShield,
} from '@fortawesome/free-solid-svg-icons';

export const DemoBanner: React.FC = () => {
  return (
    <div className="bg-amber-500 text-slate-950 px-4 py-2 text-xs md:text-sm font-semibold flex flex-wrap items-center justify-between border-b border-amber-600 shadow-sm z-50">
      <div className="flex items-center space-x-2">
        <span className="bg-slate-950 text-amber-400 font-extrabold px-2 py-0.5 rounded text-xs tracking-wider uppercase">
          Sample Data · Preview Mode
        </span>
        <span className="hidden sm:inline font-medium text-slate-900">
          CABMS Operations Console • Local Preview Adapter
        </span>
      </div>
      <div className="flex items-center space-x-3 text-xs text-slate-900 font-medium mt-1 sm:mt-0">
        <span className="inline-flex items-center gap-1">
          <FontAwesomeIcon icon={faDatabase} className="w-3.5 h-3.5" /> Sample Data
        </span>
        <span className="inline-flex items-center gap-1">
          <FontAwesomeIcon icon={faShield} className="w-3.5 h-3.5" /> Local Session
        </span>
      </div>
    </div>
  );
};
