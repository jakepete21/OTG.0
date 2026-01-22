import React from 'react';
import { ChevronRight, Building2, FileText, DollarSign, Users, Tag } from 'lucide-react';
import { AccountGroup } from '../services/accountGrouping';

interface AccountCardProps {
  account: AccountGroup;
  onClick: () => void;
}

const AccountCard: React.FC<AccountCardProps> = ({ account, onClick }) => {
  const { accountCarrier, otgCompBillingItem, summary } = account;

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-lg border border-slate-200 p-6 hover:border-indigo-300 hover:shadow-md transition-all cursor-pointer group"
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <Building2 size={18} className="text-indigo-600 flex-shrink-0" />
            <h3 className="text-lg font-semibold text-slate-800 truncate" title={accountCarrier}>
              {accountCarrier}
            </h3>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-600 mb-3">
            <FileText size={14} className="text-slate-400 flex-shrink-0" />
            <span className="truncate" title={otgCompBillingItem}>
              {otgCompBillingItem}
            </span>
          </div>
        </div>
        <ChevronRight 
          size={20} 
          className="text-slate-400 group-hover:text-indigo-600 transition-colors flex-shrink-0 ml-2" 
        />
      </div>

      <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-slate-100">
        {/* Total Monthly Comp */}
        <div className="flex items-center gap-2">
          <DollarSign size={16} className="text-green-600 flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-xs text-slate-500">Monthly Comp</p>
            <p className="text-sm font-semibold text-slate-800 truncate">
              ${summary.totalMonthlyComp.toLocaleString('en-US', { 
                minimumFractionDigits: 2, 
                maximumFractionDigits: 2 
              })}
            </p>
          </div>
        </div>

        {/* Line Item Count */}
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-blue-600 flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-xs text-slate-500">Line Items</p>
            <p className="text-sm font-semibold text-slate-800">
              {summary.lineItemCount}
            </p>
          </div>
        </div>

        {/* Service Provider (if consistent) */}
        {summary.serviceProvider && (
          <div className="flex items-center gap-2 col-span-2">
            <Tag size={16} className="text-purple-600 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-xs text-slate-500">Service Provider</p>
              <p className="text-sm font-medium text-slate-700 truncate" title={summary.serviceProvider}>
                {summary.serviceProvider}
              </p>
            </div>
          </div>
        )}

        {/* COMP 1 (if consistent) */}
        {summary.comp1 && (
          <div className="flex items-center gap-2 col-span-2">
            <Users size={16} className="text-indigo-600 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-xs text-slate-500">Primary Salesperson</p>
              <p className="text-sm font-medium text-slate-700 truncate" title={summary.comp1}>
                {summary.comp1}
              </p>
            </div>
          </div>
        )}

        {/* Status / Type (if consistent) */}
        {summary.statusType && (
          <div className="flex items-center gap-2 col-span-2">
            <Tag size={16} className="text-slate-600 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-xs text-slate-500">Status</p>
              <p className="text-sm font-medium text-slate-700 truncate" title={summary.statusType}>
                {summary.statusType}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AccountCard;
