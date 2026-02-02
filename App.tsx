import React, { useState, useMemo, useCallback } from 'react';
import './services/firebaseClient'; // Initialize Firebase
import Layout from './components/Layout';
import MasterDataList2 from './components/MasterDataList2';
import Dashboard from './components/Dashboard';
import Disputes from './components/Disputes';
import Reports from './components/Reports';
import SyncTest from './components/SyncTest';
import { AnalysisResult, CarrierStatementProcessingResult, MasterRecord } from './types';
import { useMasterData2, useSaveMasterData2 } from './services/firebaseHooks';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('comp-key');
  // Comp Key (formerly Master Data 2) loaded from Firebase (real-time updates) - used by Dashboard
  const masterData2 = useMasterData2();
  const saveMasterData2 = useSaveMasterData2();
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [carrierStatementResult, setCarrierStatementResult] = useState<CarrierStatementProcessingResult | null>(null);

  // Handle updates to master data (saves to Firebase)
  const handleMasterDataUpdate = useCallback(async (newData: MasterRecord[]) => {
    try {
      await saveMasterData2(newData);
      console.log('[App] Saved master data to Firebase');
    } catch (error: any) {
      console.error('[App] Failed to save master data to Firebase:', error);
      throw error;
    }
  }, [saveMasterData2]);

  // Derive columns from masterData2 for SyncTest
  const columns = useMemo(() => {
    if (masterData2.length === 0) return [];
    const firstRecord = masterData2[0];
    return Object.keys(firstRecord).filter(key => 
      key !== 'id' && 
      key !== 'updatedAt' && 
      !key.startsWith('_')
    );
  }, [masterData2]);

  const renderContent = () => {
    switch (activeTab) {
      case 'comp-key':
        return <MasterDataList2 data={masterData2} onUpdate={handleMasterDataUpdate} />;
      case 'upload-statement':
        return (
          <Dashboard 
            masterData={masterData2} 
            analysisResult={analysisResult} 
            setAnalysisResult={setAnalysisResult}
            carrierStatementResult={carrierStatementResult}
            setCarrierStatementResult={setCarrierStatementResult}
          />
        );
      case 'disputes':
        return <Disputes analysisResult={analysisResult} carrierStatementResult={carrierStatementResult} />;
      case 'commissions':
        return <Reports analysisResult={analysisResult} carrierStatementResult={carrierStatementResult} />;
      case 'sync-test':
        return <SyncTest masterData={masterData2} columns={columns} onUpdate={handleMasterDataUpdate} />;
      default:
        return <MasterDataList2 data={masterData2} onUpdate={handleMasterDataUpdate} />;
    }
  };

  return (
    <Layout activeTab={activeTab} onTabChange={setActiveTab}>
      {renderContent()}
    </Layout>
  );
};

export default App;