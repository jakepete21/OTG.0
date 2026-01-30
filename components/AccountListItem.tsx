import React from 'react';
import { ChevronRight, Building2, FileText, DollarSign } from 'lucide-react';
import { AccountGroup } from '../services/accountGrouping';
import { formatCurrency, formatWholeNumber } from '../services/numberFormat';

interface AccountListItemProps {
  account: AccountGroup;
  onClick: () => void;
}

const AccountListItem: React.FC<AccountListItemProps> = ({ account, onClick }) => {
  const { accountCarrier, otgCompBillingItem, summary, lineItems } = account;

  // Get ST (state) from first line item
  const getFieldValue = (record: any, ...fieldNames: string[]): string | undefined => {
    for (const fieldName of fieldNames) {
      if (record[fieldName] !== undefined && record[fieldName] !== null && record[fieldName] !== '') {
        return String(record[fieldName]);
      }
      const lowerFieldName = fieldName.toLowerCase();
      for (const key in record) {
        if (key.toLowerCase() === lowerFieldName) {
          const value = record[key];
          if (value !== undefined && value !== null && value !== '') {
            return String(value);
          }
        }
      }
    }
    return undefined;
  };

  const st = lineItems.length > 0 ? getFieldValue(lineItems[0], 'ST', 'st') : undefined;
  const serviceProvider = summary.serviceProvider || (lineItems.length > 0 ? getFieldValue(lineItems[0], 'Service Provider', 'service provider', 'serviceType') : undefined);

  return (
    <div
      onClick={onClick}
      className="bg-white border-b border-slate-200 p-4 hover:bg-slate-50 transition-colors cursor-pointer group flex items-center justify-between"
    >
      <div className="flex items-center gap-6 flex-1 min-w-0">
        {/* State */}
        <div className="w-16 flex-shrink-0">
          {st ? (
            <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-1 rounded inline-block">
              {st}
            </span>
          ) : (
            <span className="text-xs text-slate-400">-</span>
          )}
        </div>
        
        {/* Account Name */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Building2 size={18} className="text-indigo-600 flex-shrink-0" />
            <h3 className="text-base font-semibold text-slate-800 truncate" title={accountCarrier}>
              {accountCarrier}
            </h3>
          </div>
        </div>
        
        {/* Service Provider */}
        <div className="w-40 flex-shrink-0">
          <p className="text-xs text-slate-500 mb-1">Service Provider</p>
          <span className="text-sm font-semibold text-slate-800 truncate block" title={serviceProvider || '-'}>
            {serviceProvider || '-'}
          </span>
        </div>
        
        {/* Comp Billing Item */}
        <div className="w-48 flex-shrink-0">
          <p className="text-xs text-slate-500 mb-1">OTG Comp Billing Item</p>
          <div className="flex items-center gap-2">
            <FileText size={14} className="text-slate-400 flex-shrink-0" />
            <span className="text-sm font-semibold text-slate-800 truncate" title={otgCompBillingItem}>
              {otgCompBillingItem}
            </span>
          </div>
        </div>
        
        {/* Metrics */}
        <div className="flex items-center gap-6 flex-shrink-0">
          <div className="text-right">
            <p className="text-xs text-slate-500">Monthly Comp</p>
            <p className="text-sm font-semibold text-slate-800">
              {formatCurrency(summary.totalMonthlyComp)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">Line Items</p>
            <p className="text-sm font-semibold text-slate-800">
              {formatWholeNumber(summary.lineItemCount)}
            </p>
          </div>
          <ChevronRight 
            size={20} 
            className="text-slate-400 group-hover:text-indigo-600 transition-colors flex-shrink-0 ml-2" 
          />
        </div>
      </div>
    </div>
  );
};

export default AccountListItem;
