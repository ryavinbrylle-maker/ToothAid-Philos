import { useEffect, useState, useRef, useMemo } from 'react';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import NavBar from '../components/NavBar';
import PageHeader from '../components/PageHeader';
import { getAllChildren, getAllVisits, getGraduationOrder } from '../db/indexedDB';
import { performFullSync } from '../db/indexedDB';
import { 
  groupVisitsByBucket, 
  getLastNBucketsWithEqualIntervals, 
  bucketKeyToLabel, 
  assertChartData,
  getCumulativeLatestVisits
} from '../utils/timeBuckets';
import { TREATMENT_CHART_LABELS, getTreatmentCategoryAndValue } from '../utils/treatmentTypes';
import { downloadTreatmentSummaryExcel } from '../utils/exportTreatmentSummary';

const Graphs = () => {
  const [loading, setLoading] = useState(true);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const containerRef = useRef(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [fullSyncing, setFullSyncing] = useState(false);
  const [fullSyncMsg, setFullSyncMsg] = useState(null);
  
  // Granularity state - persisted in localStorage
  const [granularity, setGranularity] = useState(() => {
    const saved = localStorage.getItem('toothaid_granularity');
    return saved && ['1M', '3M', '6M'].includes(saved) ? saved : '1M';
  });
  
  // Pie chart time filter state - persisted in localStorage
  const [pieTimeFilter, setPieTimeFilter] = useState(() => {
    const saved = localStorage.getItem('toothaid_pie_time_filter');
    return saved && ['6M', '1Y', 'ALL'].includes(saved) ? saved : 'ALL';
  });
  
  // Headline metrics state
  const [metrics, setMetrics] = useState({
    totalChildren: 0,
    totalVisits: 0,
    schoolsCovered: 0,
    dateRange: null // { start: Date, end: Date }
  });
  
  const [chartData, setChartData] = useState({
    zeroCavitiesByGrade: [],       // Chart 0: % with 0 decayed teeth per grade (bar)
    avgDecayedTeeth: [],          // Chart 1: Average D per child (monthly)
    pctWithDecay: [],              // Chart 2: % with ≥1 decayed tooth (monthly)
    fDmftRatio: [],                // Chart 3: F/DMFT ratio (monthly)
    treatmentsByType: [],          // Chart 4: Treatments by type (bar)
    treatmentsBySchool: [],        // Chart 5: Treatments by school (stacked bar, top 10)
    avgDmftBySchool: [],           // Chart 6: Average DMFT by school (bar, top 10)
    avgDmftOverTime: []            // Chart 7: Average DMFT over time (monthly) - supporting
  });
  
  // Store raw visits for pie chart filtering
  const [allVisits, setAllVisits] = useState([]);
  const [visitsWithChildren, setVisitsWithChildren] = useState([]);
  const [zeroCavitiesYear, setZeroCavitiesYear] = useState(new Date().getFullYear());

  // Export treatment summary: monthly or yearly, month/year selection
  const now = new Date();
  const [exportRange, setExportRange] = useState('monthly'); // 'monthly' | 'yearly'
  const [exportMonth, setExportMonth] = useState(now.getMonth() + 1);
  const [exportYear, setExportYear] = useState(now.getFullYear());
  const [exporting, setExporting] = useState(false);
  
  // Active point state for custom tooltip (only shows when dot is touched directly)
  const [activePoint, setActivePoint] = useState(null); // { chartId, index, x, y, value, label }

  // Minimum swipe distance (in pixels) - lowered for better sensitivity
  const minSwipeDistance = 30;

  // Use refs to track touch state for non-passive event listener
  const touchStartRef = useRef({ x: 0, y: 0 });
  const touchEndRef = useRef(0);
  const swipeDirectionRef = useRef(null); // 'horizontal', 'vertical', or null

  // Add non-passive touch event listeners for proper preventDefault support
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleTouchStart = (e) => {
      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY
      };
      touchEndRef.current = e.touches[0].clientX;
      swipeDirectionRef.current = null;
    };

    const handleTouchMove = (e) => {
      const currentX = e.touches[0].clientX;
      const currentY = e.touches[0].clientY;
      const diffX = Math.abs(currentX - touchStartRef.current.x);
      const diffY = Math.abs(currentY - touchStartRef.current.y);
      
      // Lock in the swipe direction early (after just 5px of movement)
      if (swipeDirectionRef.current === null && (diffX > 5 || diffY > 5)) {
        swipeDirectionRef.current = diffX > diffY ? 'horizontal' : 'vertical';
      }
      
      // If horizontal swipe, prevent default to stop page scroll
      if (swipeDirectionRef.current === 'horizontal') {
        e.preventDefault();
      }
      
      touchEndRef.current = currentX;
    };

    const handleTouchEnd = () => {
      const distance = touchStartRef.current.x - touchEndRef.current;
      const isLeftSwipe = distance > minSwipeDistance;
      const isRightSwipe = distance < -minSwipeDistance;

      // Only handle swipe if it was horizontal
      if (swipeDirectionRef.current === 'horizontal') {
        if (isLeftSwipe && !isTransitioning) {
          handleNext();
        } else if (isRightSwipe && !isTransitioning) {
          handlePrev();
        }
      }
      
      swipeDirectionRef.current = null;
    };

    // Add with passive: false so we can preventDefault
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isTransitioning, minSwipeDistance]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleNext = () => {
    const slides = getAvailableSlides();
    if (currentSlide < slides.length - 1 && !isTransitioning) {
      setIsTransitioning(true);
      setCurrentSlide((prev) => prev + 1);
      setActivePoint(null); // Clear tooltip when switching slides
      setTimeout(() => setIsTransitioning(false), 300);
    }
  };

  const handlePrev = () => {
    if (currentSlide > 0 && !isTransitioning) {
      setIsTransitioning(true);
      setCurrentSlide((prev) => prev - 1);
      setActivePoint(null); // Clear tooltip when switching slides
      setTimeout(() => setIsTransitioning(false), 300);
    }
  };

  const getAvailableSlides = () => {
    const slides = [];
    
    // Chart 0: % with 0 cavities by grade (bar)
    if (chartData.zeroCavitiesByGrade.length > 0) {
      slides.push('zeroCavitiesByGrade');
    }
    
    // Chart 1: Average Decayed Teeth (D)
    if (chartData.avgDecayedTeeth.length > 0) {
      slides.push('avgDecayedTeeth');
    }
    
    // Chart 2: % with ≥1 decayed tooth
    if (chartData.pctWithDecay.length > 0) {
      slides.push('pctWithDecay');
    }
    
    // Chart 3: F/DMFT ratio
    if (chartData.fDmftRatio.length > 0) {
      slides.push('fDmftRatio');
    }
    
    // Chart 4: Treatments by type
    if (chartData.treatmentsByType.length > 0) {
      slides.push('treatmentsByType');
    }
    
    // Chart 5: Treatments by school
    if (chartData.treatmentsBySchool.length > 0) {
      slides.push('treatmentsBySchool');
    }
    
    // Chart 6: Average DMFT by school
    if (chartData.avgDmftBySchool.length > 0) {
      slides.push('avgDmftBySchool');
    }
    
    // Chart 7: Average DMFT over time (supporting)
    if (chartData.avgDmftOverTime.length > 0) {
      slides.push('avgDmftOverTime');
    }
    
    return slides;
  };

  // Persist granularity to localStorage
  useEffect(() => {
    localStorage.setItem('toothaid_granularity', granularity);
  }, [granularity]);
  
  // Persist pie time filter to localStorage
  useEffect(() => {
    localStorage.setItem('toothaid_pie_time_filter', pieTimeFilter);
  }, [pieTimeFilter]);

  // Handle granularity change
  const handleGranularityChange = (newGranularity) => {
    setGranularity(newGranularity);
    setActivePoint(null); // Clear tooltip when changing view
  };

  useEffect(() => {
    const loadData = async () => {
      try {
        const children = await getAllChildren();
        const visits = await getAllVisits();
        
        // Store raw visits for pie chart filtering
        setAllVisits(visits);

        // Create child lookup map
        const childMap = {};
        children.forEach(child => {
          childMap[child.childId] = child;
        });

        // Filter visits with child info
        const visitsWithChildren = visits
          .map(visit => ({
            ...visit,
            child: childMap[visit.childId],
            visitDate: new Date(visit.date)
          }))
          .filter(v => v.child);
        setVisitsWithChildren(visitsWithChildren);

        // Group visits by bucket (used for determining time range)
        const bucketedVisits = groupVisitsByBucket(visitsWithChildren, granularity);
        
        // Get the last 12 buckets with equal time intervals (fills gaps)
        const bucketKeys = getLastNBucketsWithEqualIntervals(bucketedVisits, granularity, 12);
        
        // Get cumulative latest visits per child up to each bucket (rolling approach)
        // For each bucket, shows the "current known state" based on each child's latest visit up to that point
        const cumulativeVisits = getCumulativeLatestVisits(visitsWithChildren, bucketKeys, granularity);

        // Compute headline metrics
        const uniqueSchools = new Set(children.map(c => c.school).filter(Boolean));
        
        // Calculate date range from visits
        let dateRange = null;
        if (visits.length > 0) {
          const visitDates = visits.map(v => new Date(v.date)).filter(d => !isNaN(d));
          if (visitDates.length > 0) {
            const minDate = new Date(Math.min(...visitDates));
            const maxDate = new Date(Math.max(...visitDates));
            dateRange = { start: minDate, end: maxDate };
          }
        }
        
        setMetrics({
          totalChildren: children.length,
          totalVisits: visits.length,
          schoolsCovered: uniqueSchools.size,
          dateRange
        });

        // Chart 1: Average Decayed Teeth (D) per child (rolling - latest known state at each point)
        const avgDecayedTeeth = bucketKeys.map(bucketKey => {
          const latestVisits = cumulativeVisits[bucketKey] || [];
          if (latestVisits.length === 0) {
            // No data up to this bucket - use null for gap in line
            return { label: bucketKeyToLabel(bucketKey), bucketKey, avgD: null };
          }
          const decayedValues = latestVisits.map(v => (v.decayedTeeth ?? 0));
          const totalD = decayedValues.reduce((sum, d) => sum + d, 0);
          const childCount = decayedValues.length;
          return {
            label: bucketKeyToLabel(bucketKey),
            bucketKey,
            avgD: parseFloat((totalD / childCount).toFixed(2))
          };
        });
        assertChartData(avgDecayedTeeth, 'Average Decayed Teeth');

        // Chart 2: % of children with ≥1 decayed tooth (rolling)
        const pctWithDecay = bucketKeys.map(bucketKey => {
          const latestVisits = cumulativeVisits[bucketKey] || [];
          if (latestVisits.length === 0) {
            return { label: bucketKeyToLabel(bucketKey), bucketKey, pct: null };
          }
          const childrenWithDecay = latestVisits.filter(v => (v.decayedTeeth ?? 0) >= 1).length;
          const totalChildren = latestVisits.length;
          return {
            label: bucketKeyToLabel(bucketKey),
            bucketKey,
            pct: parseFloat(((childrenWithDecay / totalChildren) * 100).toFixed(1))
          };
        });
        assertChartData(pctWithDecay, '% with Decay');

        // Chart 3: F / DMFT ratio (rolling, population-level)
        const fDmftRatio = bucketKeys.map(bucketKey => {
          const latestVisits = cumulativeVisits[bucketKey] || [];
          if (latestVisits.length === 0) {
            return { label: bucketKeyToLabel(bucketKey), bucketKey, ratio: null };
          }
          let totalF = 0;
          let totalDMFT = 0;
          latestVisits.forEach(v => {
            const D = v.decayedTeeth ?? 0;
            const M = v.missingTeeth ?? 0;
            const F = v.filledTeeth ?? 0;
            const DMFT = D + M + F;
            totalF += F;
            totalDMFT += DMFT;
          });
          const ratio = totalDMFT > 0 ? parseFloat(((totalF / totalDMFT) * 100).toFixed(1)) : 0;
          return { 
            label: bucketKeyToLabel(bucketKey),
            bucketKey,
            ratio 
          };
        });
        assertChartData(fDmftRatio, 'F/DMFT Ratio');

        // Chart 4: Treatments by Type (big titles; Extraction = sum of permanent + temporary teeth)
        const treatmentsByTypeCounts = {};
        TREATMENT_CHART_LABELS.forEach(label => { treatmentsByTypeCounts[label] = 0; });
        visits.forEach(visit => {
          if (visit.treatmentTypes && visit.treatmentTypes.length > 0) {
            visit.treatmentTypes.forEach(treatment => {
              const parsed = getTreatmentCategoryAndValue(treatment);
              if (parsed && treatmentsByTypeCounts.hasOwnProperty(parsed.category)) {
                treatmentsByTypeCounts[parsed.category] += parsed.value;
              } else if (parsed) {
                treatmentsByTypeCounts['Others'] = (treatmentsByTypeCounts['Others'] || 0) + parsed.value;
              }
            });
          }
        });
        const treatmentsByType = TREATMENT_CHART_LABELS
          .map(type => ({ type, count: treatmentsByTypeCounts[type] || 0 }))
          .filter(item => item.count > 0)
          .sort((a, b) => b.count - a.count);

        // Chart 5: Treatments by School - Stacked bar (big titles; Extraction = sum of teeth)
        const treatmentsBySchoolData = {};
        visits.forEach(visit => {
          if (visit.treatmentTypes && visit.treatmentTypes.length > 0) {
            const child = childMap[visit.childId];
            if (child && child.school) {
              const school = child.school;
              if (!treatmentsBySchoolData[school]) {
                treatmentsBySchoolData[school] = { school };
                TREATMENT_CHART_LABELS.forEach(l => { treatmentsBySchoolData[school][l] = 0; });
              }
              visit.treatmentTypes.forEach(treatment => {
                const parsed = getTreatmentCategoryAndValue(treatment);
                if (parsed) {
                  const key = treatmentsBySchoolData[school].hasOwnProperty(parsed.category) ? parsed.category : 'Others';
                  treatmentsBySchoolData[school][key] = (treatmentsBySchoolData[school][key] || 0) + parsed.value;
                }
              });
            }
          }
        });

        const treatmentsBySchool = Object.values(treatmentsBySchoolData)
          .filter(schoolData => {
            const total = Object.values(schoolData)
              .filter((v, i) => i > 0) // Skip school name
              .reduce((sum, count) => sum + count, 0);
            return total > 0;
          })
          .map(schoolData => ({
            ...schoolData,
            total: Object.values(schoolData)
              .filter((v, i) => i > 0)
              .reduce((sum, count) => sum + count, 0)
          }))
          .sort((a, b) => b.total - a.total)
          .slice(0, 10)
          .map(({ total, ...rest }) => rest); // Remove total for chart

        // Chart 6: Average DMFT by School - Bar chart (top 10)
        // Use overall latest visit per child (not monthly)
        const latestVisitsByChild = {};
        visitsWithChildren.forEach(visit => {
          const childId = visit.childId;
          if (!latestVisitsByChild[childId] || 
              visit.visitDate > latestVisitsByChild[childId].visitDate) {
            latestVisitsByChild[childId] = visit;
          }
        });

        const latestVisits = Object.values(latestVisitsByChild);

        // Chart 0: % of children with 0 decayed teeth per grade (bar chart)
        const byGrade = {};
        latestVisits.forEach(visit => {
          const grade = (visit.child && visit.child.grade) ? visit.child.grade : 'Unknown';
          if (!byGrade[grade]) byGrade[grade] = { total: 0, zero: 0 };
          byGrade[grade].total += 1;
          if ((visit.decayedTeeth ?? 0) === 0) byGrade[grade].zero += 1;
        });
        const grades1to6 = ['1st Grade', '2nd Grade', '3rd Grade', '4th Grade', '5th Grade', '6th Grade'];
        const zeroCavitiesByGrade = Object.entries(byGrade)
          .filter(([grade]) => grades1to6.includes(grade))
          .map(([grade, { total, zero }]) => ({
            grade,
            pct: total > 0 ? parseFloat(((zero / total) * 100).toFixed(1)) : 0,
            count: zero,
            total
          }))
          .sort((a, b) => getGraduationOrder(b.grade) - getGraduationOrder(a.grade));

        const dmftBySchool = {};
        const dmftCountBySchool = {};
        
        latestVisits.forEach(visit => {
          if (visit.child && visit.child.school) {
            const school = visit.child.school;
            const D = visit.decayedTeeth ?? 0;
            const M = visit.missingTeeth ?? 0;
            const F = visit.filledTeeth ?? 0;
            const DMFT = D + M + F;
            
            if (!dmftBySchool[school]) {
              dmftBySchool[school] = 0;
              dmftCountBySchool[school] = 0;
            }
            dmftBySchool[school] += DMFT;
            dmftCountBySchool[school] += 1;
          }
        });

        const avgDmftBySchool = Object.keys(dmftBySchool)
          .map(school => ({
            school: school,
            avgDmft: parseFloat(dmftCountBySchool[school] > 0
              ? (dmftBySchool[school] / dmftCountBySchool[school]).toFixed(2)
              : 0)
          }))
          .sort((a, b) => b.avgDmft - a.avgDmft)
          .slice(0, 10);

        // Chart 7: Average DMFT over time (rolling - latest known state at each point)
        const avgDmftOverTime = bucketKeys.map(bucketKey => {
          const latestVisits = cumulativeVisits[bucketKey] || [];
          if (latestVisits.length === 0) {
            return { label: bucketKeyToLabel(bucketKey), bucketKey, avgDmft: null };
          }
          const dmftValues = latestVisits.map(v => {
            const D = v.decayedTeeth ?? 0;
            const M = v.missingTeeth ?? 0;
            const F = v.filledTeeth ?? 0;
            return D + M + F;
          });
          const totalDMFT = dmftValues.reduce((sum, dmft) => sum + dmft, 0);
          const childCount = dmftValues.length;
          return {
            label: bucketKeyToLabel(bucketKey),
            bucketKey,
            avgDmft: parseFloat((totalDMFT / childCount).toFixed(2))
          };
        });
        assertChartData(avgDmftOverTime, 'Average DMFT Over Time');

        setChartData({
          zeroCavitiesByGrade,
          avgDecayedTeeth,
          pctWithDecay,
          fDmftRatio,
          treatmentsByType,
          treatmentsBySchool,
          avgDmftBySchool,
          avgDmftOverTime
        });
      } catch (error) {
        console.error('Error loading graph data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [granularity]);

  // Reset slide when data changes
  useEffect(() => {
    setCurrentSlide(0);
  }, [loading]);

  // Years that have at least one visit (for zero cavities year filter)
  const yearsWithData = useMemo(() => {
    if (!visitsWithChildren.length) return [];
    const set = new Set(visitsWithChildren.map(v => v.visitDate.getFullYear()));
    return Array.from(set).sort((a, b) => b - a);
  }, [visitsWithChildren]);

  // Keep selected year in sync with available data (select most recent year when data loads or selection is invalid)
  useEffect(() => {
    if (yearsWithData.length === 0) return;
    if (!yearsWithData.includes(zeroCavitiesYear)) {
      setZeroCavitiesYear(yearsWithData[0]);
    }
  }, [yearsWithData, zeroCavitiesYear]);

  // Export: only years that have at least one visit (from allVisits)
  const exportYearsWithData = useMemo(() => {
    if (!allVisits.length) return [];
    const set = new Set(allVisits.map(v => new Date(v.date).getFullYear()).filter(y => !isNaN(y)));
    return Array.from(set).sort((a, b) => b - a);
  }, [allVisits]);

  // Export (monthly): only months that have at least one visit in the selected year
  const exportMonthsWithDataInYear = useMemo(() => {
    if (!allVisits.length || !exportYear) return [];
    const inYear = allVisits.filter(v => {
      const d = new Date(v.date);
      return !isNaN(d) && d.getFullYear() === exportYear;
    });
    const set = new Set(inYear.map(v => new Date(v.date).getMonth() + 1));
    return Array.from(set).sort((a, b) => a - b);
  }, [allVisits, exportYear]);

  // Keep export year/month in sync with available data
  useEffect(() => {
    if (exportYearsWithData.length === 0) return;
    if (!exportYearsWithData.includes(exportYear)) {
      setExportYear(exportYearsWithData[0]);
      return;
    }
    if (exportRange === 'monthly' && exportMonthsWithDataInYear.length > 0 && !exportMonthsWithDataInYear.includes(exportMonth)) {
      setExportMonth(exportMonthsWithDataInYear[0]);
    }
  }, [exportYearsWithData, exportMonthsWithDataInYear, exportYear, exportMonth, exportRange]);

  // % with zero cavities by grade, filtered by selected year (latest visit per child within that year)
  const grades1to6 = ['1st Grade', '2nd Grade', '3rd Grade', '4th Grade', '5th Grade', '6th Grade'];
  const zeroCavitiesByGradeFiltered = useMemo(() => {
    if (!visitsWithChildren.length) return [];
    const inYear = visitsWithChildren.filter(v => v.visitDate.getFullYear() === zeroCavitiesYear);
    const latestByChild = {};
    inYear.forEach(visit => {
      const childId = visit.childId;
      if (!latestByChild[childId] || visit.visitDate > latestByChild[childId].visitDate) {
        latestByChild[childId] = visit;
      }
    });
    const latestVisits = Object.values(latestByChild);
    const byGrade = {};
    latestVisits.forEach(visit => {
      const grade = (visit.child && visit.child.grade) ? visit.child.grade : 'Unknown';
      if (!byGrade[grade]) byGrade[grade] = { total: 0, zero: 0 };
      byGrade[grade].total += 1;
      if ((visit.decayedTeeth ?? 0) === 0) byGrade[grade].zero += 1;
    });
    return grades1to6
      .map(grade => {
        const data = byGrade[grade] || { total: 0, zero: 0 };
        return {
          grade,
          pct: data.total > 0 ? parseFloat(((data.zero / data.total) * 100).toFixed(1)) : 0,
          count: data.zero,
          total: data.total
        };
      })
      .sort((a, b) => getGraduationOrder(b.grade) - getGraduationOrder(a.grade));
  }, [visitsWithChildren, zeroCavitiesYear]);

  const colors = {
    Filling: 'var(--color-primary)',
    Extraction: 'var(--color-accent)',
    Fluoride: 'var(--color-success)',
    Sealant: 'var(--color-warning)',
    SDF: '#6366F1',
    Cleaning: '#06B6D4',
    Other: '#6B7280'
  };

  const getBarColor = (value, maxValue) => {
    if (maxValue === 0) return 'var(--color-success)';
    const ratio = value / maxValue;
    if (ratio > 0.7) return 'var(--color-accent)';
    if (ratio > 0.4) return 'var(--color-warning)';
    return 'var(--color-success)';
  };

  // Distinct colors for school bars
  const schoolColors = [
    'var(--color-primary)',
    'var(--color-accent)',
    'var(--color-success)',
    'var(--color-warning)',
    '#6366F1', // Indigo
    '#06B6D4', // Cyan
    '#A855F7', // Purple
    '#14B8A6', // Teal
    '#F43F5E', // Rose
    '#6B7280'  // Gray
  ];

  // Filter visits for pie chart based on time filter
  const filteredVisitsForPie = useMemo(() => {
    if (allVisits.length === 0) return [];
    
    const now = new Date();
    let cutoffDate = null;
    
    if (pieTimeFilter === '6M') {
      cutoffDate = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
    } else if (pieTimeFilter === '1Y') {
      cutoffDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    }
    // 'ALL' means no filtering
    
    if (cutoffDate) {
      return allVisits.filter(v => new Date(v.date) >= cutoffDate);
    }
    return allVisits;
  }, [allVisits, pieTimeFilter]);
  
  // Memoize pie chart data: all treatment types (big titles), Extraction = sum of permanent + temporary teeth
  const pieChartData = useMemo(() => {
    if (filteredVisitsForPie.length === 0) return [];
    const counts = {};
    TREATMENT_CHART_LABELS.forEach(l => { counts[l] = 0; });
    filteredVisitsForPie.forEach(visit => {
      if (visit.treatmentTypes && visit.treatmentTypes.length > 0) {
        visit.treatmentTypes.forEach(treatment => {
          const parsed = getTreatmentCategoryAndValue(treatment);
          if (parsed) {
            const key = counts.hasOwnProperty(parsed.category) ? parsed.category : 'Others';
            counts[key] = (counts[key] || 0) + parsed.value;
          }
        });
      }
    });
    return TREATMENT_CHART_LABELS
      .map((name, i) => ({ name, value: counts[name] || 0, color: schoolColors[i % schoolColors.length] }))
      .filter(item => item.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [filteredVisitsForPie]);

  // Custom interactive dot component - only responds to direct touch/click on the dot
  // Uses a larger invisible touch target for better mobile usability
  const createInteractiveDot = (chartId, color, dataKey, valueFormatter) => {
    return (props) => {
      const { cx, cy, payload, index } = props;
      if (cx === undefined || cy === undefined || payload[dataKey] === null) return null;
      
      const isActive = activePoint?.chartId === chartId && activePoint?.index === index;
      const visibleRadius = isActive ? 10 : 7;
      const touchTargetRadius = 22; // Large invisible touch target
      
      const handleClick = (e) => {
        e.stopPropagation();
        if (isActive) {
          setActivePoint(null);
        } else {
          setActivePoint({
            chartId,
            index,
            x: cx,
            y: cy,
            value: payload[dataKey],
            label: payload.label,
            formattedValue: valueFormatter(payload[dataKey])
          });
        }
      };
      
      return (
        <g>
          {/* Invisible larger touch target */}
          <circle
            cx={cx}
            cy={cy}
            r={touchTargetRadius}
            fill="transparent"
            style={{ cursor: 'pointer' }}
            onClick={handleClick}
            onTouchEnd={handleClick}
          />
          {/* Visible dot */}
          <circle
            cx={cx}
            cy={cy}
            r={visibleRadius}
            fill={color}
            stroke="#fff"
            strokeWidth={2}
            style={{ pointerEvents: 'none', transition: 'r 0.15s' }}
          />
        </g>
      );
    };
  };
  
  // Custom tooltip that appears near the selected point
  const CustomPointTooltip = ({ chartId }) => {
    if (!activePoint || activePoint.chartId !== chartId) return null;
    
    return (
      <div style={{
        position: 'absolute',
        left: activePoint.x,
        top: activePoint.y - 45,
        transform: 'translateX(-50%)',
        background: 'rgba(255, 255, 255, 0.95)',
        border: '1px solid #ccc',
        borderRadius: '4px',
        padding: '6px 10px',
        fontSize: '12px',
        fontWeight: '600',
        boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
        pointerEvents: 'none',
        zIndex: 10,
        whiteSpace: 'nowrap'
      }}>
        <div style={{ color: '#666', fontSize: '11px' }}>{activePoint.label}</div>
        <div style={{ color: '#333' }}>{activePoint.formattedValue}</div>
      </div>
    );
  };
  
  // Clear active point when clicking outside
  const handleChartClick = () => {
    setActivePoint(null);
  };

  // Uniform x-axis ticks: show evenly spaced labels so we never skip inconsistently (e.g. Q2, Q4, Q2, Q4)
  // X-axis ticks at a fixed step (e.g. every 2nd or 4th point) so intervals are uniform
  const getUniformXTicks = (data, maxTicks = 8) => {
    if (!data?.length) return undefined;
    const n = data.length;
    if (n <= maxTicks) return data.map((d) => d.label);
    const step = Math.max(1, Math.ceil(n / maxTicks));
    const indices = [];
    for (let i = 0; i < n; i += step) {
      indices.push(i);
    }
    if (indices[indices.length - 1] !== n - 1) {
      indices.push(n - 1);
    }
    return indices.map((i) => data[i].label);
  };

  // Granularity selector component for line charts
  const GranularitySelector = () => (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    }}>
      <span style={{ fontSize: '13px', color: '#8e8e93' }}>View:</span>
      <div style={{
        display: 'flex',
        background: '#f2f2f7',
        borderRadius: '10px',
        padding: '4px'
      }}>
        {[
          { value: '1M', label: 'Monthly' },
          { value: '3M', label: 'Quarterly' },
          { value: '6M', label: 'Half-year' }
        ].map(option => (
          <button
            key={option.value}
            onClick={() => handleGranularityChange(option.value)}
            onTouchEnd={(e) => {
              e.preventDefault();
              handleGranularityChange(option.value);
            }}
            style={{
              padding: '8px 12px',
              minHeight: '36px',
              border: 'none',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.15s',
              background: granularity === option.value ? 'var(--color-primary)' : 'transparent',
              color: granularity === option.value ? 'white' : '#8e8e93',
              WebkitTapHighlightColor: 'transparent'
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );

  const renderSlide = (slideType, slideIndex) => {
    switch (slideType) {
      case 'zeroCavitiesByGrade':
        if (chartData.zeroCavitiesByGrade.length === 0 || yearsWithData.length === 0) return null;
        return (
          <div className="card" style={{ marginBottom: '20px', minHeight: '300px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
              <h2 style={{ margin: 0, fontSize: '18px' }}>% with Zero Cavities by Grade</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <label style={{ fontSize: '14px', color: 'var(--color-muted)' }}>Year</label>
                <select
                  value={yearsWithData.includes(zeroCavitiesYear) ? zeroCavitiesYear : (yearsWithData[0] ?? zeroCavitiesYear)}
                  onChange={(e) => setZeroCavitiesYear(Number(e.target.value))}
                  style={{
                    padding: '6px 10px',
                    borderRadius: '8px',
                    border: '1px solid var(--color-border)',
                    background: '#fff',
                    fontSize: '14px',
                    color: 'var(--color-text)',
                    cursor: 'pointer'
                  }}
                >
                  {yearsWithData.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={250} style={{ outline: 'none', userSelect: 'none', WebkitUserSelect: 'none', WebkitTapHighlightColor: 'transparent' }}>
              <BarChart data={zeroCavitiesByGradeFiltered} margin={{ top: 5, right: 10, bottom: 10, left: -20 }} style={{ outline: 'none' }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="grade"
                  tick={false}
                  axisLine={{ stroke: '#ccc' }}
                  tickLine={false}
                />
                <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 10 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
                    padding: '6px 10px',
                    fontSize: '12px'
                  }}
                  labelStyle={{ color: '#666', fontSize: '11px', marginBottom: '2px' }}
                  itemStyle={{ color: '#333', fontWeight: '600' }}
                  formatter={(value) => [`${value}%`, '% with 0 cavities']}
                />
                <Bar dataKey="pct" name="% with 0 cavities" radius={[8, 8, 0, 0]}>
                  {zeroCavitiesByGradeFiltered.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={schoolColors[index % schoolColors.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              marginTop: '16px',
              paddingTop: '16px',
              borderTop: '1px solid #e0e0e0'
            }}>
              {zeroCavitiesByGradeFiltered.map((entry, index) => (
                <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div
                    style={{
                      width: '16px',
                      height: '16px',
                      backgroundColor: schoolColors[index % schoolColors.length],
                      borderRadius: '2px',
                      flexShrink: 0
                    }}
                  />
                  <span style={{ fontSize: '14px', color: '#333' }}>{entry.grade}</span>
                  <span style={{ fontSize: '12px', color: '#888', marginLeft: 'auto' }}>({entry.pct}%)</span>
                </div>
              ))}
            </div>
          </div>
        );

      case 'avgDecayedTeeth':
        return (
          <div className="card" style={{ marginBottom: '20px', minHeight: '400px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
              <h2 style={{ fontSize: '18px', margin: 0 }}>Average Decayed Teeth per Child (D)</h2>
            </div>
            <GranularitySelector />
            <div style={{ position: 'relative' }} onClick={handleChartClick}>
              <CustomPointTooltip chartId="avgDecayedTeeth" />
              <ResponsiveContainer width="100%" height={320} style={{ outline: 'none', userSelect: 'none', WebkitUserSelect: 'none', WebkitTapHighlightColor: 'transparent' }}>
                <LineChart data={chartData.avgDecayedTeeth} margin={{ top: 10, right: 10, bottom: 5, left: -20 }} style={{ outline: 'none' }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" ticks={getUniformXTicks(chartData.avgDecayedTeeth)} tick={{ fontSize: 11 }} />
                  <YAxis />
                  <Line 
                    type="monotone" 
                    dataKey="avgD" 
                    stroke="var(--color-accent)" 
                    strokeWidth={3}
                    dot={createInteractiveDot('avgDecayedTeeth', 'var(--color-accent)', 'avgD', (v) => `${v.toFixed(2)} avg decayed`)}
                    activeDot={false}
                    name="Average Decayed Teeth"
                    connectNulls={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        );

      case 'pctWithDecay':
        return (
          <div className="card" style={{ marginBottom: '20px', minHeight: '400px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
              <h2 style={{ fontSize: '18px', margin: 0 }}>% of Children with ≥1 Decayed Tooth</h2>
            </div>
            <GranularitySelector />
            <div style={{ position: 'relative' }} onClick={handleChartClick}>
              <CustomPointTooltip chartId="pctWithDecay" />
              <ResponsiveContainer width="100%" height={320} style={{ outline: 'none', userSelect: 'none', WebkitUserSelect: 'none', WebkitTapHighlightColor: 'transparent' }}>
                <LineChart data={chartData.pctWithDecay} margin={{ top: 10, right: 10, bottom: 5, left: -20 }} style={{ outline: 'none' }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" ticks={getUniformXTicks(chartData.pctWithDecay)} tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} />
                  <Line 
                    type="monotone" 
                    dataKey="pct" 
                    stroke="var(--color-warning)" 
                    strokeWidth={3}
                    dot={createInteractiveDot('pctWithDecay', 'var(--color-warning)', 'pct', (v) => `${v}%`)}
                    activeDot={false}
                    name="% with Decay"
                    connectNulls={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        );

      case 'fDmftRatio':
        return (
          <div className="card" style={{ marginBottom: '20px', minHeight: '400px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
              <h2 style={{ fontSize: '18px', margin: 0 }}>F / DMFT Ratio</h2>
            </div>
            <GranularitySelector />
            <div style={{ position: 'relative' }} onClick={handleChartClick}>
              <CustomPointTooltip chartId="fDmftRatio" />
              <ResponsiveContainer width="100%" height={320} style={{ outline: 'none', userSelect: 'none', WebkitUserSelect: 'none', WebkitTapHighlightColor: 'transparent' }}>
                <LineChart data={chartData.fDmftRatio} margin={{ top: 10, right: 10, bottom: 5, left: -20 }} style={{ outline: 'none' }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" ticks={getUniformXTicks(chartData.fDmftRatio)} tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} />
                  <Line 
                    type="monotone" 
                    dataKey="ratio" 
                    stroke="var(--color-success)" 
                    strokeWidth={3}
                    dot={createInteractiveDot('fDmftRatio', 'var(--color-success)', 'ratio', (v) => `${v}% F/DMFT`)}
                    activeDot={false}
                    name="F/DMFT %"
                    connectNulls={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        );

      case 'treatmentsByType':
        if (pieChartData.length === 0) return null;
        
        // Label function for pie chart - shows percentage outside the slice (no lines)
        const total = pieChartData.reduce((sum, item) => sum + item.value, 0);
        
        const renderLabel = ({ cx, cy, midAngle, outerRadius, index }) => {
          const item = pieChartData[index];
          if (!item) return null;
          const pct = (item.value / total) * 100;
          if (pct < 3) return null; // Hide labels for very small slices (<3%)
          const RADIAN = Math.PI / 180;
          const radius = outerRadius * 1.25;
          const x = cx + radius * Math.cos(-midAngle * RADIAN);
          const y = cy + radius * Math.sin(-midAngle * RADIAN);
          
          return (
            <text 
              x={x} 
              y={y} 
              fill="#333"
              textAnchor={x > cx ? 'start' : 'end'} 
              dominantBaseline="central"
              style={{ fontSize: '12px', fontWeight: '600' }}
            >
              {`${pct.toFixed(1)}%`}
            </text>
          );
        };
        
        return (
          <div style={{ 
            background: 'white', 
            borderRadius: '16px', 
            padding: '20px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            marginBottom: '20px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
              <h2 style={{ fontSize: '17px', fontWeight: '600', margin: 0, color: '#1c1c1e' }}>Treatments by Type</h2>
              {/* Time filter selector for pie chart */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '13px', color: '#8e8e93' }}>View:</span>
                <div style={{
                  display: 'flex',
                  background: '#f2f2f7',
                  borderRadius: '10px',
                  padding: '4px'
                }}>
                  {[
                    { value: '6M', label: '6 months' },
                    { value: '1Y', label: '1 year' },
                    { value: 'ALL', label: 'All' }
                  ].map(option => (
                    <button
                      key={option.value}
                      onClick={() => setPieTimeFilter(option.value)}
                      onTouchEnd={(e) => {
                        e.preventDefault();
                        setPieTimeFilter(option.value);
                      }}
                      style={{
                        padding: '8px 12px',
                        minHeight: '36px',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '13px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                        background: pieTimeFilter === option.value ? 'var(--color-primary)' : 'transparent',
                        color: pieTimeFilter === option.value ? 'white' : '#8e8e93',
                        WebkitTapHighlightColor: 'transparent'
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={280} style={{ outline: 'none', userSelect: 'none', WebkitUserSelect: 'none', WebkitTapHighlightColor: 'transparent' }}>
              <PieChart style={{ outline: 'none' }}>
                <Pie
                  data={pieChartData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={renderLabel}
                  outerRadius={85}
                  fill="#8884d8"
                  dataKey="value"
                  isAnimationActive={false}
                >
                  {pieChartData.map((entry, index) => (
                    <Cell key={`cell-${entry.name}-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'rgba(255, 255, 255, 0.95)', 
                    border: '1px solid #ccc', 
                    borderRadius: '4px',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
                    padding: '6px 10px',
                    fontSize: '12px'
                  }}
                  labelStyle={{ color: '#666', fontSize: '11px', marginBottom: '2px' }}
                  itemStyle={{ color: '#333', fontWeight: '600' }}
                  formatter={(value, name) => [value, name || 'Count']}
                />
              </PieChart>
            </ResponsiveContainer>
            
            {/* Divider line and Custom Legend */}
            <div style={{ 
              borderTop: '1px solid #e0e0e0',
              marginTop: '16px',
              paddingTop: '16px'
            }}>
              <div style={{ 
                display: 'flex', 
                flexWrap: 'wrap', 
                gap: '8px 16px',
                justifyContent: 'center'
              }}>
                {pieChartData.map((item, index) => (
                  <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ 
                      width: '12px', 
                      height: '12px', 
                      backgroundColor: item.color,
                      borderRadius: '2px'
                    }} />
                    <span style={{ fontSize: '12px', color: '#666' }}>{item.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );

      case 'treatmentsBySchool':
        if (chartData.treatmentsBySchool.length === 0) return null;
        const treatmentLegendItems = TREATMENT_CHART_LABELS.map((label, i) => ({
          key: label,
          color: schoolColors[i % schoolColors.length]
        }));
        return (
          <div className="card" style={{ marginBottom: '20px', minHeight: '400px' }}>
            <h2 style={{ marginBottom: '16px', fontSize: '18px' }}>Treatments by School</h2>
            <ResponsiveContainer width="100%" height={250} style={{ outline: 'none', userSelect: 'none', WebkitUserSelect: 'none', WebkitTapHighlightColor: 'transparent' }}>
              <BarChart data={chartData.treatmentsBySchool} margin={{ top: 5, right: 10, bottom: 10, left: -20 }} style={{ outline: 'none' }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="school" 
                  tick={false}
                  axisLine={{ stroke: '#ccc' }}
                  tickLine={false}
                />
                <YAxis domain={[0, 'auto']} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'rgba(255, 255, 255, 0.95)', 
                    border: '1px solid #ccc', 
                    borderRadius: '4px',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
                    padding: '6px 10px',
                    fontSize: '12px'
                  }}
                  labelStyle={{ color: '#666', fontSize: '11px', marginBottom: '2px' }}
                  itemStyle={{ fontWeight: '600' }}
                />
                {TREATMENT_CHART_LABELS.map((label, i) => (
                  <Bar key={label} dataKey={label} stackId="a" fill={schoolColors[i % schoolColors.length]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
            
            {/* Divider line */}
            <div style={{ 
              borderTop: '1px solid #e0e0e0',
              marginTop: '20px',
              paddingTop: '16px'
            }}>
              {/* Treatment Types Legend */}
              <div style={{ 
                display: 'flex', 
                flexWrap: 'wrap', 
                gap: '8px 16px',
                justifyContent: 'center',
                marginBottom: '16px'
              }}>
                {treatmentLegendItems.map((item) => (
                  <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ 
                      width: '12px', 
                      height: '12px', 
                      backgroundColor: item.color,
                      borderRadius: '2px'
                    }} />
                    <span style={{ fontSize: '12px', color: '#666' }}>{item.key}</span>
                  </div>
                ))}
              </div>
              
              {/* School Names - Row by Row */}
              <p style={{ fontSize: '12px', color: '#666', marginBottom: '8px' }}>Schools (left to right):</p>
              <div style={{ 
                display: 'flex', 
                flexDirection: 'column',
                gap: '6px'
              }}>
                {chartData.treatmentsBySchool.map((entry, index) => (
                  <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ 
                      fontSize: '12px', 
                      fontWeight: '600',
                      color: 'var(--color-primary)',
                      minWidth: '20px'
                    }}>
                      {index + 1}.
                    </span>
                    <span style={{ fontSize: '14px', color: '#333' }}>{entry.school}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );

      case 'avgDmftBySchool':
        if (chartData.avgDmftBySchool.length === 0) return null;
        
        return (
          <div className="card" style={{ marginBottom: '20px', minHeight: '300px' }}>
            <h2 style={{ marginBottom: '16px', fontSize: '18px' }}>Average DMFT by School</h2>
            <ResponsiveContainer width="100%" height={250} style={{ outline: 'none', userSelect: 'none', WebkitUserSelect: 'none', WebkitTapHighlightColor: 'transparent' }}>
              <BarChart data={chartData.avgDmftBySchool} margin={{ top: 5, right: 10, bottom: 10, left: -20 }} style={{ outline: 'none' }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="school" 
                  tick={false}
                  axisLine={{ stroke: '#ccc' }}
                  tickLine={false}
                />
                <YAxis domain={[0, 'auto']} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'rgba(255, 255, 255, 0.95)', 
                    border: '1px solid #ccc', 
                    borderRadius: '4px',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
                    padding: '6px 10px',
                    fontSize: '12px'
                  }}
                  labelStyle={{ color: '#666', fontSize: '11px', marginBottom: '2px' }}
                  itemStyle={{ color: '#333', fontWeight: '600' }}
                  formatter={(value) => [value.toFixed(2), 'Average DMFT']}
                />
                <Bar dataKey="avgDmft" name="Average DMFT" radius={[8, 8, 0, 0]}>
                  {chartData.avgDmftBySchool.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={schoolColors[index % schoolColors.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            {/* Custom Legend - Row by Row */}
            <div style={{ 
              display: 'flex', 
              flexDirection: 'column',
              gap: '8px', 
              marginTop: '16px', 
              paddingTop: '16px',
              borderTop: '1px solid #e0e0e0'
            }}>
              {chartData.avgDmftBySchool.map((entry, index) => (
                <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div 
                    style={{ 
                      width: '16px', 
                      height: '16px', 
                      backgroundColor: schoolColors[index % schoolColors.length],
                      borderRadius: '2px',
                      flexShrink: 0
                    }} 
                  />
                  <span style={{ fontSize: '14px', color: '#333' }}>{entry.school}</span>
                  <span style={{ fontSize: '12px', color: '#888', marginLeft: 'auto' }}>({entry.avgDmft})</span>
                </div>
              ))}
            </div>
          </div>
        );

      case 'avgDmftOverTime':
        return (
          <div className="card" style={{ marginBottom: '20px', minHeight: '400px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
              <h2 style={{ fontSize: '18px', margin: 0 }}>Average DMFT Over Time</h2>
            </div>
            <GranularitySelector />
            <div style={{ position: 'relative' }} onClick={handleChartClick}>
              <CustomPointTooltip chartId="avgDmftOverTime" />
              <ResponsiveContainer width="100%" height={320} style={{ outline: 'none', userSelect: 'none', WebkitUserSelect: 'none', WebkitTapHighlightColor: 'transparent' }}>
                <LineChart data={chartData.avgDmftOverTime} margin={{ top: 10, right: 10, bottom: 5, left: -20 }} style={{ outline: 'none' }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" ticks={getUniformXTicks(chartData.avgDmftOverTime)} tick={{ fontSize: 11 }} />
                  <YAxis />
                  <Line 
                    type="monotone" 
                    dataKey="avgDmft" 
                    stroke="var(--color-primary)" 
                    strokeWidth={3}
                    dot={createInteractiveDot('avgDmftOverTime', 'var(--color-primary)', 'avgDmft', (v) => `${v.toFixed(2)} avg DMFT`)}
                    activeDot={false}
                    name="Average DMFT"
                    connectNulls={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="container">
        <div className="loading">Loading graphs...</div>
        <NavBar />
      </div>
    );
  }

  const availableSlides = getAvailableSlides();

  if (availableSlides.length === 0) {
    return (
      <div className="container">
        <PageHeader title="Reports" subtitle="Data visualization and insights" icon="reports" />
        <div className="card">
          <div className="empty-state">No data available yet. Register children and add visits to see statistics.</div>
        </div>
        <NavBar />
      </div>
    );
  }

  const currentSlideType = availableSlides[currentSlide];

  return (
    <div className="container">
      <PageHeader title="Reports" subtitle="Data visualization and insights" icon="reports" />

      {/* Dataset Overview Section */}
      <div style={{ marginTop: '8px', marginBottom: '28px' }}>
        {/* Section Title */}
        <h2 style={{
          fontSize: '14px',
          fontWeight: '600',
          color: 'var(--color-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          marginBottom: '12px',
          paddingLeft: '4px'
        }}>
          Dataset Overview
        </h2>

        {/* Metrics Container Card */}
        <div style={{
          background: '#f8f9fa',
          border: '1px solid #e9ecef',
          borderRadius: '12px',
          padding: '14px 16px'
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '10px 16px'
          }}>
            <div style={{ padding: '6px 8px' }}>
              <div style={{ 
                fontSize: '20px', 
                fontWeight: '600', 
                color: '#495057',
                lineHeight: 1
              }}>
                {metrics.totalChildren}
              </div>
              <div style={{ 
                fontSize: '13px', 
                color: '#6c757d',
                marginTop: '2px'
              }}>
                Total Children
              </div>
            </div>
            <div style={{ padding: '6px 8px' }}>
              <div style={{ 
                fontSize: '20px', 
                fontWeight: '600', 
                color: '#495057',
                lineHeight: 1
              }}>
                {metrics.totalVisits}
              </div>
              <div style={{ 
                fontSize: '13px', 
                color: '#6c757d',
                marginTop: '2px'
              }}>
                Total Visits
              </div>
            </div>
            <div style={{ padding: '6px 8px' }}>
              <div style={{ 
                fontSize: '20px', 
                fontWeight: '600', 
                color: '#495057',
                lineHeight: 1
              }}>
                {metrics.schoolsCovered}
              </div>
              <div style={{ 
                fontSize: '13px', 
                color: '#6c757d',
                marginTop: '2px'
              }}>
                Schools Covered
              </div>
            </div>
            <div style={{ padding: '6px 8px' }}>
              <div style={{ 
                fontSize: '20px', 
                fontWeight: '600', 
                color: '#495057',
                lineHeight: 1
              }}>
                {metrics.dateRange ? (
                  <>
                    <span style={{ whiteSpace: 'nowrap' }}>
                      {metrics.dateRange.start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                    </span>
                    <span style={{ margin: '0 4px' }}>–</span>
                    <span style={{ whiteSpace: 'nowrap' }}>
                      {metrics.dateRange.end.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                    </span>
                  </>
                ) : (
                  'No data'
                )}
              </div>
              <div style={{ 
                fontSize: '13px', 
                color: '#6c757d',
                marginTop: '2px'
              }}>
                Coverage
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Export treatment summary (Excel) - same design as Dataset Overview */}
      <div style={{ marginBottom: '28px' }}>
        <h2 style={{
          fontSize: '14px',
          fontWeight: '600',
          color: 'var(--color-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          marginBottom: '12px',
          paddingLeft: '4px'
        }}>
          Export
        </h2>

        <div style={{
          background: '#f8f9fa',
          border: '1px solid #e9ecef',
          borderRadius: '12px',
          padding: '14px 16px'
        }}>
          {/* Pill toggle: Monthly / Yearly */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
            <button
              type="button"
              onClick={() => setExportRange('monthly')}
              className={`chip-toggle${exportRange === 'monthly' ? ' chip-toggle--active' : ''}`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setExportRange('yearly')}
              className={`chip-toggle${exportRange === 'yearly' ? ' chip-toggle--active' : ''}`}
            >
              Yearly
            </button>
          </div>

          {/* Month (only when Monthly) and Year dropdowns - only options that have data */}
          <div style={{ display: 'flex', gap: '12px', marginBottom: '14px', flexWrap: 'wrap' }}>
            {exportRange === 'monthly' && exportMonthsWithDataInYear.length > 0 && (
              <div style={{ flex: '1 1 140px', minWidth: '120px' }}>
                <label style={{ fontSize: '13px', color: '#6c757d', display: 'block', marginBottom: '4px' }}>
                  Month
                </label>
                <select
                  value={exportMonthsWithDataInYear.includes(exportMonth) ? exportMonth : (exportMonthsWithDataInYear[0] ?? exportMonth)}
                  onChange={(e) => setExportMonth(Number(e.target.value))}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid #e9ecef',
                    background: '#fff',
                    fontSize: '14px',
                    color: '#495057',
                    cursor: 'pointer',
                    appearance: 'auto'
                  }}
                >
                  {exportMonthsWithDataInYear.map((m) => (
                    <option key={m} value={m}>
                      {new Date(2000, m - 1, 1).toLocaleString('default', { month: 'long' })}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {exportYearsWithData.length > 0 && (
              <div style={{ flex: '1 1 100px', minWidth: '90px' }}>
                <label style={{ fontSize: '13px', color: '#6c757d', display: 'block', marginBottom: '4px' }}>
                  Year
                </label>
                <select
                  value={exportYearsWithData.includes(exportYear) ? exportYear : (exportYearsWithData[0] ?? exportYear)}
                  onChange={(e) => setExportYear(Number(e.target.value))}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid #e9ecef',
                    background: '#fff',
                    fontSize: '14px',
                    color: '#495057',
                    cursor: 'pointer',
                    appearance: 'auto'
                  }}
                >
                  {exportYearsWithData.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Download Excel button */}
          <button
            type="button"
            disabled={exporting || allVisits.length === 0}
            onClick={async () => {
              setExporting(true);
              try {
                await downloadTreatmentSummaryExcel(allVisits, exportRange, exportMonth, exportYear);
              } catch (e) {
                console.error(e);
                alert('Export failed. Please try again.');
              } finally {
                setExporting(false);
              }
            }}
            style={{
              width: '100%',
              padding: '14px 20px',
              borderRadius: 'var(--radius-btn)',
              border: 'none',
              background: 'var(--color-primary)',
              color: '#fff',
              fontSize: '15px',
              fontWeight: '600',
              cursor: allVisits.length === 0 || exporting ? 'not-allowed' : 'pointer',
              opacity: exporting || allVisits.length === 0 ? 0.7 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px'
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {exporting ? 'Generating…' : 'Download Excel'}
          </button>
        </div>
      </div>

      {/* Charts Section Label */}
      <h2 style={{
        fontSize: '14px',
        fontWeight: '600',
        color: 'var(--color-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        marginBottom: '12px',
        paddingLeft: '4px'
      }}>
        Trends
      </h2>

      {/* Navigation */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center',
        gap: '16px',
        marginBottom: '16px'
      }}>
        <button
          onClick={handlePrev}
          disabled={currentSlide === 0}
          style={{
            width: '32px',
            height: '32px',
            border: 'none',
            borderRadius: '50%',
            background: currentSlide === 0 ? '#f2f2f7' : 'var(--color-primary)',
            color: currentSlide === 0 ? '#c7c7cc' : 'white',
            cursor: currentSlide === 0 ? 'not-allowed' : 'pointer',
            fontSize: '18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: '300'
          }}
        >
          ‹
        </button>

        {/* Slide indicators */}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {availableSlides.map((_, index) => (
            <button
              key={index}
              onClick={() => {
                if (!isTransitioning) {
                  setIsTransitioning(true);
                  setCurrentSlide(index);
                  setTimeout(() => setIsTransitioning(false), 300);
                }
              }}
              style={{
                width: index === currentSlide ? '18px' : '6px',
                height: '6px',
                borderRadius: '3px',
                border: 'none',
                background: index === currentSlide ? 'var(--color-primary)' : '#d1d1d6',
                cursor: 'pointer',
                transition: 'all 0.3s'
              }}
              aria-label={`Go to slide ${index + 1}`}
            />
          ))}
        </div>

        <button
          onClick={handleNext}
          disabled={currentSlide === availableSlides.length - 1}
          style={{
            width: '32px',
            height: '32px',
            border: 'none',
            borderRadius: '50%',
            background: currentSlide === availableSlides.length - 1 ? '#f2f2f7' : 'var(--color-primary)',
            color: currentSlide === availableSlides.length - 1 ? '#c7c7cc' : 'white',
            cursor: currentSlide === availableSlides.length - 1 ? 'not-allowed' : 'pointer',
            fontSize: '18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: '300'
          }}
        >
          ›
        </button>
      </div>

      {/* Slide container with swipe support */}
      <div
        ref={containerRef}
        style={{
          touchAction: 'pan-y pinch-zoom', // Allow vertical scroll and pinch, we handle horizontal
          userSelect: 'none',
          WebkitUserSelect: 'none',
          overflow: 'hidden',
          position: 'relative'
        }}
      >
        <div
          style={{
            display: 'flex',
            transform: `translateX(-${currentSlide * 100}%)`,
            transition: 'transform 0.3s ease-in-out',
            willChange: 'transform'
          }}
        >
          {availableSlides.map((slideType, index) => (
            <div
              key={slideType}
              style={{
                minWidth: '100%',
                width: '100%',
                flexShrink: 0
              }}
            >
              {renderSlide(slideType, index)}
            </div>
          ))}
        </div>
      </div>

      {/* Swipe hint */}
      <p style={{ 
        textAlign: 'center', 
        color: '#c7c7cc', 
        fontSize: '12px', 
        marginTop: '8px',
        marginBottom: '16px'
      }}>
        Swipe to see more trends
      </p>

      {/* Advanced Setting */}
      <div style={{ marginBottom: '28px' }}>
        <h2 style={{
          fontSize: '14px',
          fontWeight: '600',
          color: 'var(--color-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          marginBottom: '12px',
          paddingLeft: '4px'
        }}>
          Advanced Setting
        </h2>

        <div style={{
          background: '#f8f9fa',
          border: '1px solid #e9ecef',
          borderRadius: '12px',
          padding: '14px 16px'
        }}>
          <div style={{ fontSize: '13px', color: '#6c757d', marginBottom: '10px' }}>
            Full sync will re-pull all data from server (useful for demo / dev).
          </div>

          {fullSyncMsg && (
            <div style={{ fontSize: '13px', color: '#6c757d', marginBottom: '10px' }}>
              {fullSyncMsg}
            </div>
          )}

          <button
            type="button"
            disabled={!isOnline || fullSyncing}
            onClick={async () => {
              const token = localStorage.getItem('token');
              if (!token) {
                setFullSyncMsg('Not logged in');
                return;
              }
              setFullSyncing(true);
              setFullSyncMsg(null);
              try {
                const result = await performFullSync(token);
                if (result?.success) {
                  setFullSyncMsg(result.message || 'Full sync completed');
                } else {
                  setFullSyncMsg(`Full sync failed: ${result?.error || 'unknown error'}`);
                }
              } catch (e) {
                setFullSyncMsg(`Full sync failed: ${e?.message || 'unknown error'}`);
              } finally {
                setFullSyncing(false);
              }
            }}
            style={{
              width: '100%',
              padding: '14px 20px',
              borderRadius: 'var(--radius-btn)',
              border: 'none',
              background: 'var(--color-accent)',
              color: '#fff',
              fontSize: '15px',
              fontWeight: '600',
              cursor: !isOnline || fullSyncing ? 'not-allowed' : 'pointer',
              opacity: !isOnline || fullSyncing ? 0.7 : 1
            }}
          >
            {fullSyncing ? 'Full Syncing…' : 'Full Sync'}
          </button>
        </div>
      </div>

      <NavBar />
    </div>
  );
};

export default Graphs;
