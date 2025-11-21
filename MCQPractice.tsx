import React, { useState, useEffect } from 'react';
import { ArrowLeft, CheckCircle, XCircle, AlertCircle, RotateCcw, Bookmark, Tag, SlidersHorizontal, Settings2, X, Clock, ChevronDown, ChevronUp, Eye } from 'lucide-react';
import { collection, query, where, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { User } from 'firebase/auth';
import { db } from '../firebase';
import { Chapter, MCQ, Topic } from '../types';

interface MCQPracticeProps {
  chapter: Chapter;
  onBack: () => void;
  user: User;
  isQuickRevision?: boolean;
}

interface UserAnswerResult {
  questionId: string;
  question: string;
  options: string[];
  correctAnswer: number; // 1-based index from DB
  selectedOption: number; // 0-based index from UI
  isCorrect: boolean;
  explanation?: string;
}

const MCQPractice: React.FC<MCQPracticeProps> = ({ chapter, onBack, user, isQuickRevision = false }) => {
  const [allQuestions, setAllQuestions] = useState<MCQ[]>([]); // Store all fetched source data
  const [questions, setQuestions] = useState<MCQ[]>([]); // Store filtered & sliced current session data
  const [topics, setTopics] = useState<Topic[]>([]);
  
  // Filter State
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [showFilterModal, setShowFilterModal] = useState(false);
  
  // Temporary Filter State (inside modal)
  const [tempTopicId, setTempTopicId] = useState<string | null>(null);
  const [tempCount, setTempCount] = useState<number>(20);

  const [loading, setLoading] = useState(true);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [isAnswerChecked, setIsAnswerChecked] = useState(false);
  const [score, setScore] = useState(0);
  const [showScore, setShowScore] = useState(false);
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(new Set());

  // New Features State
  const [elapsedTime, setElapsedTime] = useState(0);
  const [userAnswers, setUserAnswers] = useState<UserAnswerResult[]>([]);
  const [showReview, setShowReview] = useState(false);
  
  // Toast State
  const [toast, setToast] = useState<{ show: boolean; message: string } | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        // 1. Fetch all questions for the chapter
        const q = query(
          collection(db, 'questions'),
          where('chapterId', '==', chapter.id)
        );
        const questionSnapshot = await getDocs(q);
        let fetchedQuestions = questionSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as MCQ[];

        // 2. Fetch topics for this chapter
        if (!isQuickRevision) {
           const topicQ = query(collection(db, 'topics'), where('chapterId', '==', chapter.id));
           const topicSnap = await getDocs(topicQ);
           const fetchedTopics = topicSnap.docs.map(doc => ({
             id: doc.id,
             ...doc.data()
           })) as Topic[];
           setTopics(fetchedTopics);
        }

        // 3. Fetch user bookmarks
        const bookmarksRef = collection(db, 'users', user.uid, 'bookmarks');
        const bookmarksSnapshot = await getDocs(bookmarksRef);
        const userBookmarks = new Set(bookmarksSnapshot.docs.map(doc => doc.id));
        setBookmarkedIds(userBookmarks);

        // 4. If in Quick Revision mode, filter questions
        if (isQuickRevision) {
          fetchedQuestions = fetchedQuestions.filter(q => q.id && userBookmarks.has(q.id));
        }

        setAllQuestions(fetchedQuestions);
        setQuestions(fetchedQuestions); // Initially show all
      } catch (error) {
        console.error("Error fetching data:", (error as any).message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [chapter.id, user.uid, isQuickRevision]);

  // Timer Logic
  useEffect(() => {
    let timer: any;
    if (!loading && !showScore && questions.length > 0) {
      timer = setInterval(() => {
        setElapsedTime(prev => prev + 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [loading, showScore, questions.length]);

  // Trigger MathJax when question changes
  useEffect(() => {
    if (!loading && (window as any).MathJax) {
      setTimeout(() => {
        (window as any).MathJax.typesetPromise && (window as any).MathJax.typesetPromise();
      }, 100);
    }
  }, [currentQuestionIndex, loading, isAnswerChecked, questions, showReview]);

  // Handle Toast Timeout
  useEffect(() => {
    if (toast?.show) {
      const timer = setTimeout(() => {
        setToast(null);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // Helper: Get max available questions for a specific topic (or all)
  const getMaxAvailable = (tId: string | null) => {
    if (!tId) return allQuestions.length;
    return allQuestions.filter(q => q.topicId === tId).length;
  };

  const handleOpenFilter = () => {
    setTempTopicId(selectedTopicId);
    const available = getMaxAvailable(selectedTopicId);
    setTempCount(questions.length > 0 ? Math.min(questions.length, available) : available);
    setShowFilterModal(true);
  };

  const handleApplyFilter = () => {
    let filtered = [...allQuestions];

    // 1. Filter by Topic
    if (tempTopicId) {
      filtered = filtered.filter(q => q.topicId === tempTopicId);
    }

    // 2. Shuffle (Randomize)
    filtered = filtered.sort(() => Math.random() - 0.5);

    // 3. Limit Count
    const max = filtered.length;
    const finalLimit = Math.max(1, Math.min(tempCount, max));
    
    if (finalLimit < max) {
      filtered = filtered.slice(0, finalLimit);
    }

    // Apply State
    setQuestions(filtered);
    setSelectedTopicId(tempTopicId);
    
    // Reset Game State
    setCurrentQuestionIndex(0);
    setSelectedOption(null);
    setIsAnswerChecked(false);
    setScore(0);
    setShowScore(false);
    setElapsedTime(0);
    setUserAnswers([]);
    setShowReview(false);

    setShowFilterModal(false);
    setToast({ show: true, message: 'Settings Applied & Restarted!' });
  };

  const handleOptionClick = (index: number) => {
    if (isAnswerChecked) return;
    setSelectedOption(index);
  };

  const handleCheckAnswer = async () => {
    if (selectedOption === null) return;
    
    const currentQuestion = questions[currentQuestionIndex];
    // Database now stores 1-based index (1=A, 2=B...)
    // We compare selectedOption (0-based) + 1 with stored correctAnswer
    const isCorrect = (selectedOption + 1) === Number(currentQuestion.correctAnswer);
    
    if (isCorrect) {
      setScore(prev => prev + 1);
    }
    setIsAnswerChecked(true);

    // Store attempt for detailed review
    const answerRecord: UserAnswerResult = {
      questionId: currentQuestion.id || 'unknown',
      question: currentQuestion.question,
      options: currentQuestion.options,
      correctAnswer: currentQuestion.correctAnswer,
      selectedOption: selectedOption,
      isCorrect: isCorrect,
      explanation: currentQuestion.explanation
    };
    setUserAnswers(prev => [...prev, answerRecord]);

    // Save Progress to Firestore
    if (currentQuestion.id && !isQuickRevision) {
       try {
         const attemptRef = doc(db, 'users', user.uid, 'attempts', currentQuestion.id);
         await setDoc(attemptRef, {
           questionId: currentQuestion.id,
           chapterId: chapter.id,
           subjectId: chapter.subjectId,
           isCorrect: isCorrect,
           timestamp: Date.now()
         });
       } catch (err) {
         console.error("Error saving progress:", (err as any).message);
       }
    }
  };

  const handleNext = () => {
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
      setSelectedOption(null);
      setIsAnswerChecked(false);
    } else {
      setShowScore(true);
    }
  };

  const handleRestart = () => {
    // Reshuffle and restart using current settings
    handleApplyFilter();
  };

  const toggleBookmark = async (question: MCQ) => {
    if (!question.id) return;
    const qId = question.id;
    const isBookmarked = bookmarkedIds.has(qId);

    // Optimistic UI update
    setBookmarkedIds(prev => {
      const newSet = new Set(prev);
      if (isBookmarked) {
        newSet.delete(qId);
        setToast({ show: true, message: 'Removed from bookmarks' });
      } else {
        newSet.add(qId);
        setToast({ show: true, message: 'Added to bookmarks' });
      }
      return newSet;
    });

    try {
      const bookmarkRef = doc(db, 'users', user.uid, 'bookmarks', qId);
      if (isBookmarked) {
        await deleteDoc(bookmarkRef);
      } else {
        await setDoc(bookmarkRef, {
          questionId: qId,
          chapterId: chapter.id,
          subjectId: chapter.subjectId,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error("Error toggling bookmark:", (error as any).message);
      // Revert on error
      setBookmarkedIds(prev => {
        const newSet = new Set(prev);
        if (isBookmarked) newSet.add(qId);
        else newSet.delete(qId);
        return newSet;
      });
      setToast({ show: true, message: 'Error updating bookmark' });
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col h-[calc(100vh-80px)] pb-4 animate-pulse">
         <div className="flex items-center justify-between mb-6 mt-2">
            <div className="w-8 h-8 bg-white/10 rounded-full"></div>
            <div className="flex flex-col items-center gap-1">
               <div className="h-4 w-32 bg-white/10 rounded"></div>
               <div className="h-3 w-20 bg-white/5 rounded"></div>
            </div>
            <div className="w-8 h-8"></div>
         </div>
         <div className="w-full h-1.5 bg-white/10 rounded-full mb-6"></div>
         
         <div className="bg-app-card rounded-2xl p-8 border border-white/5 mb-4 h-40">
            <div className="h-4 w-full bg-white/10 rounded mb-3"></div>
            <div className="h-4 w-3/4 bg-white/10 rounded"></div>
         </div>

         <div className="space-y-3">
            {[1, 2, 3, 4].map(i => (
               <div key={i} className="w-full p-4 rounded-xl border border-white/5 flex items-center gap-3 h-16">
                  <div className="w-6 h-6 rounded-full bg-white/10 shrink-0"></div>
                  <div className="h-4 w-full bg-white/10 rounded"></div>
               </div>
            ))}
         </div>
      </div>
    );
  }

  if (allQuestions.length === 0) {
    return (
      <div className="p-6 text-center flex flex-col h-full">
        <div className="flex items-center gap-3 mb-6 mt-2">
           <button 
            onClick={onBack} 
            className="p-2 hover:bg-white/10 rounded-full transition-colors -ml-2"
          >
             <ArrowLeft className="w-6 h-6 text-gray-400 hover:text-white" />
          </button>
          <h2 className="text-xl font-bold text-white">{chapter.title}</h2>
        </div>
        <div className="bg-app-card p-8 rounded-2xl border border-white/5 flex flex-col items-center justify-center flex-1">
          <AlertCircle className="w-12 h-12 text-gray-500 mb-4" />
          <p className="text-gray-400 mb-4">
            {isQuickRevision 
              ? "এই অধ্যায়ে আপনার কোনো বুকমার্ক করা প্রশ্ন নেই।" 
              : "এই অধ্যায়ের জন্য কোনো প্রশ্ন পাওয়া যায়নি।"}
          </p>
          <button onClick={onBack} className="px-6 py-3 bg-gray-800 rounded-xl text-white hover:bg-gray-700 transition-colors">ফিরে যান</button>
        </div>
      </div>
    );
  }

  // Score Screen
  if (showScore) {
    const percentage = Math.round((score / questions.length) * 100);
    return (
      <div className="animate-in fade-in zoom-in duration-300 pb-24 h-full overflow-y-auto scrollbar-hide">
        <div className="bg-app-card rounded-3xl p-8 border border-white/10 flex flex-col items-center text-center mt-4 shadow-2xl mx-4">
          <h2 className="text-2xl font-bold text-white mb-2">
            {isQuickRevision ? 'রিভিশন সম্পন্ন!' : 'প্র্যাকটিস সম্পন্ন!'}
          </h2>
          <p className="text-gray-400 text-sm mb-6">{chapter.title}</p>
          
          {/* Score Circle */}
          <div className="w-32 h-32 rounded-full border-4 border-green-500 flex flex-col items-center justify-center mb-6 relative bg-green-500/5">
            <span className="text-xs text-gray-400 uppercase tracking-wider mb-1">Score</span>
            <div className="text-3xl font-bold text-white leading-none">{score}/{questions.length}</div>
            {percentage >= 80 && (
               <div className="absolute -top-2 -right-2 bg-yellow-500 p-2 rounded-full border-4 border-[#1E1E1E]">
                 <CheckCircle className="w-5 h-5 text-black" />
               </div>
            )}
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-3 gap-3 w-full mb-6">
             <div className="bg-green-500/10 p-3 rounded-xl border border-green-500/20 flex flex-col items-center">
               <p className="text-green-500 text-[10px] font-bold uppercase tracking-wider mb-1">সঠিক</p>
               <p className="text-xl font-bold text-white">{score}</p>
             </div>
             <div className="bg-red-500/10 p-3 rounded-xl border border-red-500/20 flex flex-col items-center">
               <p className="text-red-500 text-[10px] font-bold uppercase tracking-wider mb-1">ভুল</p>
               <p className="text-xl font-bold text-white">{questions.length - score}</p>
             </div>
             <div className="bg-blue-500/10 p-3 rounded-xl border border-blue-500/20 flex flex-col items-center">
               <p className="text-blue-500 text-[10px] font-bold uppercase tracking-wider mb-1">সময়</p>
               <p className="text-xl font-bold text-white">{formatTime(elapsedTime)}</p>
             </div>
          </div>

          <div className="flex gap-3 w-full mb-4">
            <button 
              onClick={onBack} 
              className="flex-1 py-3 rounded-xl border border-white/10 text-white font-semibold hover:bg-white/5 transition-colors text-sm"
            >
              ফিরে যান
            </button>
            <button 
              onClick={handleRestart} 
              className="flex-1 py-3 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-500 transition-colors flex items-center justify-center gap-2 text-sm"
            >
              <RotateCcw className="w-4 h-4" />
              আবার চেষ্টা করুন
            </button>
          </div>

          {/* Review Toggle */}
          <button 
             onClick={() => setShowReview(!showReview)}
             className="w-full py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 text-sm font-medium flex items-center justify-center gap-2 transition-all"
          >
             {showReview ? <ChevronUp className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
             {showReview ? 'উত্তরপত্র লুকান' : 'উত্তরপত্র দেখুন (Review)'}
          </button>
          
          {/* Detailed Review List */}
          {showReview && (
            <div className="w-full mt-6 space-y-4 text-left animate-in slide-in-from-bottom-4">
              <h3 className="text-white font-bold text-lg border-b border-white/10 pb-2">বিস্তারিত উত্তরপত্র</h3>
              {userAnswers.map((ans, idx) => (
                 <div key={idx} className={`bg-[#121212] p-4 rounded-xl border ${ans.isCorrect ? 'border-green-500/30' : 'border-red-500/30'}`}>
                    <div className="flex items-start gap-3">
                       <div className="mt-1 shrink-0">
                          {ans.isCorrect ? <CheckCircle className="w-5 h-5 text-green-500" /> : <XCircle className="w-5 h-5 text-red-500" />}
                       </div>
                       <div className="flex-1 min-w-0">
                          <p className="text-gray-200 font-medium text-sm mb-3 leading-relaxed">{idx + 1}. {ans.question}</p>
                          <div className="space-y-2">
                             {ans.options.map((opt, optIdx) => {
                                const isSelected = ans.selectedOption === optIdx;
                                const isCorrectOpt = (Number(ans.correctAnswer) - 1) === optIdx;
                                let style = "text-gray-500";
                                if (isCorrectOpt) style = "text-green-400 font-bold";
                                else if (isSelected && !isCorrectOpt) style = "text-red-400";
                                
                                return (
                                  <div key={optIdx} className={`text-xs flex items-center gap-3 p-2 rounded-lg ${
                                      isCorrectOpt ? 'bg-green-900/10' : (isSelected ? 'bg-red-900/10' : '')
                                  }`}>
                                     <div className={`w-5 h-5 rounded-full border flex items-center justify-center text-[10px] shrink-0 ${
                                        isCorrectOpt ? 'border-green-500 bg-green-500 text-black font-bold' : 
                                        (isSelected ? 'border-red-500 bg-red-500 text-white' : 'border-gray-600')
                                     }`}>
                                        {String.fromCharCode(65 + optIdx)}
                                     </div>
                                     <span className={style}>{opt}</span>
                                  </div>
                                )
                             })}
                          </div>
                          {ans.explanation && (
                            <div className="mt-3 p-3 bg-blue-500/5 border border-blue-500/10 rounded-lg">
                              <p className="text-[10px] text-blue-400 font-bold uppercase mb-1">ব্যাখ্যা</p>
                              <p className="text-xs text-gray-400">{ans.explanation}</p>
                            </div>
                          )}
                       </div>
                    </div>
                 </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const currentQuestion = questions[currentQuestionIndex];
  const isBookmarked = currentQuestion?.id ? bookmarkedIds.has(currentQuestion.id) : false;

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] pb-4 relative">
      {/* Toast Notification */}
      {toast?.show && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 bg-gray-800/95 backdrop-blur-md text-white px-4 py-2.5 rounded-full text-xs font-medium shadow-xl border border-white/10 z-50 animate-in fade-in slide-in-from-bottom-4 flex items-center gap-2 whitespace-nowrap">
          <CheckCircle className="w-3.5 h-3.5 text-green-500" />
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-4 mt-2">
        <button 
          onClick={onBack} 
          className="p-2 hover:bg-white/10 rounded-full transition-colors -ml-2"
        >
           <ArrowLeft className="w-6 h-6 text-gray-400 hover:text-white" />
        </button>
        
        {/* Timer & Progress */}
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-1.5 text-gray-300 bg-white/5 px-3 py-1 rounded-full mb-1 border border-white/5">
             <Clock className="w-3 h-3 text-green-400" />
             <span className="text-xs font-mono font-medium tabular-nums">{formatTime(elapsedTime)}</span>
          </div>
          <p className="text-gray-500 text-[10px] font-medium">
             Question <span className="text-white">{currentQuestionIndex + 1}</span> / {questions.length}
          </p>
        </div>

        {/* Filter Button */}
        <button 
           onClick={handleOpenFilter}
           className={`p-2 rounded-full transition-colors ${selectedTopicId ? 'bg-green-500/20 text-green-500' : 'hover:bg-white/10 text-gray-400 hover:text-white'} -mr-2`}
           title="Filter Topics & Limit"
        >
           {selectedTopicId ? <Settings2 className="w-6 h-6" /> : <SlidersHorizontal className="w-6 h-6" />}
        </button>
      </div>

      {/* Filter Modal */}
      {showFilterModal && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-4">
           <div className="bg-app-card w-full max-w-md rounded-3xl border border-white/10 p-6 shadow-2xl animate-in slide-in-from-bottom-10 zoom-in-95">
              <div className="flex justify-between items-center mb-6">
                 <h3 className="text-xl font-bold text-white flex items-center gap-2">
                    <Settings2 className="w-5 h-5 text-green-500" />
                    Practice Settings
                 </h3>
                 <button onClick={() => setShowFilterModal(false)} className="p-1 rounded-full hover:bg-white/10">
                    <X className="w-6 h-6 text-gray-500" />
                 </button>
              </div>
              
              {/* Topic Selection */}
              {!isQuickRevision && topics.length > 0 && (
                 <div className="mb-6">
                    <label className="text-xs text-gray-400 uppercase font-bold tracking-wider mb-3 block">Select Topic</label>
                    <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto pr-1 scrollbar-hide">
                       <button 
                          onClick={() => setTempTopicId(null)}
                          className={`p-3 rounded-xl text-sm font-medium transition-all border ${tempTopicId === null ? 'bg-green-600 border-green-500 text-white' : 'bg-white/5 border-transparent text-gray-400 hover:bg-white/10'}`}
                       >
                          All Topics
                       </button>
                       {topics.map(topic => (
                          <button 
                             key={topic.id}
                             onClick={() => setTempTopicId(topic.id)}
                             className={`p-3 rounded-xl text-sm font-medium transition-all border truncate ${tempTopicId === topic.id ? 'bg-green-600 border-green-500 text-white' : 'bg-white/5 border-transparent text-gray-400 hover:bg-white/10'}`}
                          >
                             {topic.title}
                          </button>
                       ))}
                    </div>
                 </div>
              )}

              {/* Count Selection */}
              <div className="mb-8">
                 <div className="flex justify-between items-center mb-3">
                    <label className="text-xs text-gray-400 uppercase font-bold tracking-wider">Number of Questions</label>
                    <span className="text-xs text-green-500 font-medium">Available: {getMaxAvailable(tempTopicId)}</span>
                 </div>
                 <div className="flex items-center gap-4">
                    <input 
                       type="range" 
                       min="1" 
                       max={getMaxAvailable(tempTopicId)} 
                       value={tempCount}
                       onChange={(e) => setTempCount(Number(e.target.value))}
                       className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-green-500"
                    />
                    <div className="w-16 h-12 bg-white/5 rounded-lg flex items-center justify-center border border-white/10">
                       <input 
                          type="number" 
                          min="1" 
                          max={getMaxAvailable(tempTopicId)} 
                          value={tempCount}
                          onChange={(e) => setTempCount(Number(e.target.value))}
                          className="w-full bg-transparent text-center text-white font-bold focus:outline-none appearance-none"
                       />
                    </div>
                 </div>
              </div>

              {/* Action Button */}
              <button 
                 onClick={handleApplyFilter}
                 className="w-full py-4 rounded-xl bg-green-600 text-white font-bold text-lg hover:bg-green-500 transition-all active:scale-[0.98] shadow-lg shadow-green-900/20"
              >
                 Start Practice
              </button>
           </div>
        </div>
      )}

      {/* Progress Bar */}
      <div className="w-full h-1 bg-gray-800 rounded-full overflow-hidden mb-6">
        <div 
          className="h-full bg-green-500 transition-all duration-300 ease-out shadow-[0_0_10px_rgba(34,197,94,0.5)]"
          style={{ width: questions.length > 0 ? `${((currentQuestionIndex + 1) / questions.length) * 100}%` : '0%' }}
        ></div>
      </div>

      {/* Question Card */}
      <div className="flex-1 overflow-y-auto scrollbar-hide pb-20">
        {currentQuestion ? (
          <>
             <div className="bg-app-card rounded-2xl p-6 border border-white/5 mb-4 shadow-lg relative group">
               {/* Bookmark Icon */}
               <button 
                 onClick={() => toggleBookmark(currentQuestion)}
                 className="absolute top-4 right-4 p-2 text-gray-400 hover:text-yellow-400 hover:bg-white/5 rounded-full transition-all active:scale-90 z-10"
                 title="Bookmark for Quick Revision"
               >
                 <Bookmark className={`w-6 h-6 ${isBookmarked ? 'fill-yellow-400 text-yellow-400' : ''}`} />
               </button>

               <h3 className="text-lg font-medium text-white leading-relaxed pr-8">
                 {currentQuestion.question}
               </h3>
               
               {/* Display Topic Tag if topic is selected or just purely informational */}
               {currentQuestion.topicId && (
                  <div className="mt-3 inline-flex items-center gap-1 px-2 py-1 bg-white/5 rounded text-[10px] text-gray-500 border border-white/5">
                     <Tag className="w-3 h-3" />
                     {topics.find(t => t.id === currentQuestion.topicId)?.title || 'Topic'}
                  </div>
               )}
             </div>

             <div className="space-y-3">
               {currentQuestion.options.map((option, index) => {
                 let optionStyle = "border-white/10 hover:bg-white/5 bg-app-card";
                 let icon = <div className="w-6 h-6 rounded-full border-2 border-gray-600 flex items-center justify-center text-xs font-medium text-gray-400 group-hover:border-gray-400 transition-colors shrink-0">{String.fromCharCode(65 + index)}</div>;

                 if (isAnswerChecked) {
                    // Convert 1-based stored answer to 0-based index for checking
                    const correctIndex = Number(currentQuestion.correctAnswer) - 1;

                    if (index === correctIndex) {
                      optionStyle = "border-green-500 bg-green-500/10";
                      icon = <CheckCircle className="w-6 h-6 text-green-500 shrink-0 fill-green-500/20" />;
                    } else if (index === selectedOption) {
                      optionStyle = "border-red-500 bg-red-500/10";
                      icon = <XCircle className="w-6 h-6 text-red-500 shrink-0 fill-red-500/20" />;
                    } else {
                      optionStyle = "border-white/5 opacity-40";
                    }
                 } else if (selectedOption === index) {
                    optionStyle = "border-blue-500 bg-blue-500/10";
                    icon = <div className="w-6 h-6 rounded-full border-2 border-blue-500 flex items-center justify-center shrink-0 bg-blue-500"><div className="w-2 h-2 bg-white rounded-full"></div></div>;
                 }

                 return (
                   <button
                     key={index}
                     onClick={() => handleOptionClick(index)}
                     disabled={isAnswerChecked}
                     className={`w-full p-4 rounded-xl border text-left transition-all active:scale-[0.99] flex items-center gap-4 group ${optionStyle}`}
                   >
                     {icon}
                     <span className={`flex-1 text-sm font-medium ${isAnswerChecked && (index + 1) === Number(currentQuestion.correctAnswer) ? 'text-green-400' : 'text-gray-200'}`}>
                       {option}
                     </span>
                   </button>
                 );
               })}
             </div>
             
             {/* Explanation Box (Only if checked) */}
             {isAnswerChecked && currentQuestion.explanation && (
                <div className="mt-6 p-4 bg-gradient-to-r from-blue-500/10 to-transparent border-l-4 border-blue-500 rounded-r-xl animate-in fade-in slide-in-from-bottom-2">
                  <h4 className="text-blue-400 text-xs font-bold mb-2 uppercase flex items-center gap-2">
                     <AlertCircle className="w-3 h-3" /> ব্যাখ্যা
                  </h4>
                  <p className="text-gray-300 text-sm leading-relaxed">{currentQuestion.explanation}</p>
                </div>
             )}
          </>
        ) : (
           <div className="h-full flex flex-col items-center justify-center text-gray-500 text-center">
              <AlertCircle className="w-8 h-8 mb-2" />
              <p>No questions match the current filter.</p>
              <button onClick={handleOpenFilter} className="text-green-500 text-sm mt-2 underline">Change Settings</button>
           </div>
        )}
      </div>

      {/* Footer Action Button */}
      <div className="absolute bottom-4 left-4 right-4 max-w-md mx-auto z-20">
        {!isAnswerChecked ? (
          <button
            onClick={handleCheckAnswer}
            disabled={selectedOption === null}
            className="w-full py-4 rounded-xl bg-white text-black font-bold text-lg hover:bg-gray-200 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-white/10"
          >
            যাচাই করুন
          </button>
        ) : (
          <button
            onClick={handleNext}
            className="w-full py-4 rounded-xl bg-green-600 text-white font-bold text-lg hover:bg-green-500 transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-lg shadow-green-900/30"
          >
            {currentQuestionIndex < questions.length - 1 ? 'পরবর্তী প্রশ্ন' : 'ফলাফল দেখুন'}
            <ArrowLeft className="w-5 h-5 rotate-180" />
          </button>
        )}
      </div>
    </div>
  );
};

export default MCQPractice;