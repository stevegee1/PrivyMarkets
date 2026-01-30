import { useState } from 'react';
import { createPortal } from 'react-dom';

function HowItWorks() {
  const [isOpen, setIsOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  const steps = [
    {
      number: 1,
      title: "Admin Creates Market",
      description: "Admins create prediction markets with a question, category, and initial liquidity. Markets are stored on-chain with encrypted details.",
    },
    {
      number: 2,
      title: "Buy 'Yes' or 'No' Shares",
      description: "Trade on outcomes by buying YES or NO shares depending on your prediction. Your positions are completely private - only you know what you bet and how much.",
    },
    {
      number: 3,
      title: "Admin Resolves Market",
      description: "When the event concludes, admins resolve the market by selecting YES or NO. The winning outcome is recorded on-chain.",
    },
    {
      number: 4,
      title: "Winners Claim Payouts",
      description: "If you bet on the winning outcome, claim your payout privately. Each winning share pays 1 credit directly to your wallet.",
    }
  ];

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      setIsOpen(false);
      setCurrentStep(0);
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center space-x-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
      >
        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
        </div>
        <span className="hidden sm:inline">How it works</span>
      </button>
    );
  }

  const step = steps[currentStep];

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/80 z-[100] backdrop-blur-sm"
        onClick={() => {
          setIsOpen(false);
          setCurrentStep(0);
        }}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-[101] flex items-center justify-center p-4">
        <div
          className="bg-slate-800 rounded-2xl shadow-2xl max-w-2xl w-full relative"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close Button */}
          <button
            onClick={() => {
              setIsOpen(false);
              setCurrentStep(0);
            }}
            className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors z-10"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Content */}
          <div className="px-8 py-12 text-center">
            {/* Step Number */}
            <div className="text-6xl font-bold text-white mb-6">
              {step.number}.
            </div>

            {/* Step Title */}
            <h2 className="text-3xl font-bold text-white mb-4">
              {step.title}
            </h2>

            {/* Step Description */}
            <p className="text-lg text-gray-300 leading-relaxed max-w-lg mx-auto">
              {step.description}
            </p>
          </div>

          {/* Navigation */}
          <div className="px-8 pb-8">
            {/* Progress Dots */}
            <div className="flex justify-center space-x-2 mb-6">
              {steps.map((_, index) => (
                <button
                  key={index}
                  onClick={() => setCurrentStep(index)}
                  className={`w-2 h-2 rounded-full transition-all ${
                    index === currentStep
                      ? 'bg-blue-500 w-8'
                      : 'bg-gray-600 hover:bg-gray-500'
                  }`}
                />
              ))}
            </div>

            {/* Buttons */}
            <div className="flex items-center justify-between">
              {currentStep > 0 ? (
                <button
                  onClick={handlePrev}
                  className="text-gray-400 hover:text-white font-medium transition-colors"
                >
                  ← Previous
                </button>
              ) : (
                <div />
              )}

              <button
                onClick={handleNext}
                className="bg-blue-500 hover:bg-blue-600 text-white font-semibold px-8 py-3 rounded-lg transition-colors"
              >
                {currentStep < steps.length - 1 ? 'Next' : 'Get Started'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}

export default HowItWorks;
