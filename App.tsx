import React, { useState } from 'react';
import './services/firebaseClient'; // Initialize Firebase
import Layout from './components/Layout';
import MasterDataList2 from './components/MasterDataList2';
import Dashboard from './components/Dashboard';
import Disputes from './components/Disputes';
import Reports from './components/Reports';
import { AnalysisResult, CarrierStatementProcessingResult } from './types';
import { useMasterData2 } from './services/firebaseHooks';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('comp-key');
  // Comp Key (formerly Master Data 2) loaded from Firebase (real-time updates) - used by Dashboard
  const masterData2 = useMasterData2();
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [carrierStatementResult, setCarrierStatementResult] = useState<CarrierStatementProcessingResult | null>(null);

  const renderContent = () => {
    switch (activeTab) {
      case 'comp-key':
        return <MasterDataList2 data={masterData2} onUpdate={() => {}} />;
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
      default:
        return <MasterDataList2 data={masterData2} onUpdate={() => {}} />;
    }
  };

  return (
    <Layout activeTab={activeTab} onTabChange={setActiveTab}>
      {renderContent()}
    </Layout>
  );
};

export default App;