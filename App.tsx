import React, { useState, useEffect } from 'react';
import './services/firebaseClient'; // Initialize Firebase
import Layout from './components/Layout';
import MasterDataList from './components/MasterDataList';
import MasterDataList2 from './components/MasterDataList2';
import Dashboard from './components/Dashboard';
import Disputes from './components/Disputes';
import Reports from './components/Reports';
import { MasterRecord, AnalysisResult, CarrierStatementProcessingResult } from './types';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('master-data');
  const [masterData, setMasterData] = useState<MasterRecord[]>([]);
  const [masterData2, setMasterData2] = useState<MasterRecord[]>([]);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [carrierStatementResult, setCarrierStatementResult] = useState<CarrierStatementProcessingResult | null>(null);

  const renderContent = () => {
    switch (activeTab) {
      case 'master-data':
        return <MasterDataList data={masterData} onUpdate={setMasterData} />;
      case 'master-data-2':
        return <MasterDataList2 data={masterData2} onUpdate={setMasterData2} />;
      case 'upload-statement':
        return (
          <Dashboard 
            masterData={masterData} 
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
        return <MasterDataList data={masterData} onUpdate={setMasterData} />;
    }
  };

  return (
    <Layout activeTab={activeTab} onTabChange={setActiveTab}>
      {renderContent()}
    </Layout>
  );
};

export default App;