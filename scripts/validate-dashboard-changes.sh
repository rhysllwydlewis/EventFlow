#!/bin/bash
# Pre-Deployment Validation Script
# Validates the supplier dashboard CSS refactoring changes

echo "=================================================="
echo "Pre-Deployment Validation: Supplier Dashboard"
echo "=================================================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Counters
PASS=0
FAIL=0
WARN=0

# Function to report test result
test_result() {
    if [ "$1" -eq 0 ]; then
        echo -e "${GREEN}✓ PASS${NC}: $2"
        ((PASS++))
    elif [ "$1" -eq 2 ]; then
        echo -e "${YELLOW}⚠ WARN${NC}: $2"
        ((WARN++))
    else
        echo -e "${RED}✗ FAIL${NC}: $2"
        ((FAIL++))
    fi
}

echo "1. File Existence Checks"
echo "-------------------------"

# Check CSS file exists
if [ -f "public/assets/css/supplier-dashboard-improvements.css" ]; then
    test_result 0 "CSS file exists"
else
    test_result 1 "CSS file missing"
fi

# Check HTML file exists
if [ -f "public/dashboard-supplier.html" ]; then
    test_result 0 "HTML file exists"
else
    test_result 1 "HTML file missing"
fi

# Check documentation exists
if [ -f "docs/CSS_CLASS_SYSTEM.md" ]; then
    test_result 0 "CSS documentation exists"
else
    test_result 2 "CSS documentation missing"
fi

echo ""
echo "2. Git Status Checks"
echo "--------------------"

# Check .env not tracked
if git ls-files | grep -q "^\.env$"; then
    test_result 1 ".env is tracked (SECURITY RISK)"
else
    test_result 0 ".env not tracked"
fi

# Check .gitignore exists
if [ -f ".gitignore" ]; then
    test_result 0 ".gitignore exists"
else
    test_result 1 ".gitignore missing"
fi

# Check .env in .gitignore
if grep -q "^\.env$" .gitignore; then
    test_result 0 ".env in .gitignore"
else
    test_result 1 ".env not in .gitignore"
fi

echo ""
echo "3. CSS Validation"
echo "-----------------"

# Check CSS file size
CSS_LINES=$(wc -l < public/assets/css/supplier-dashboard-improvements.css)
if [ "$CSS_LINES" -ge 850 ] && [ "$CSS_LINES" -le 900 ]; then
    test_result 0 "CSS file size appropriate ($CSS_LINES lines)"
else
    test_result 2 "CSS file size unexpected ($CSS_LINES lines)"
fi

# Check for new CSS classes
if grep -q "supplier-cta-banner" public/assets/css/supplier-dashboard-improvements.css; then
    test_result 0 "CTA banner classes added"
else
    test_result 1 "CTA banner classes missing"
fi

if grep -q "lead-quality-fill" public/assets/css/supplier-dashboard-improvements.css; then
    test_result 0 "Lead quality classes added"
else
    test_result 1 "Lead quality classes missing"
fi

echo ""
echo "4. HTML Validation"
echo "------------------"

# Count inline styles
INLINE_STYLES=$(grep -c 'style="' public/dashboard-supplier.html)
if [ "$INLINE_STYLES" -le 15 ]; then
    test_result 0 "Inline styles reduced ($INLINE_STYLES remaining)"
else
    test_result 1 "Too many inline styles ($INLINE_STYLES)"
fi

# Check classList usage
CLASSLIST_COUNT=$(grep -c "classList" public/dashboard-supplier.html)
if [ "$CLASSLIST_COUNT" -ge 8 ]; then
    test_result 0 "classList API used ($CLASSLIST_COUNT occurrences)"
else
    test_result 2 "classList usage low ($CLASSLIST_COUNT occurrences)"
fi

# Check for problematic style.display
STYLE_DISPLAY=$(grep -c "style.display" public/dashboard-supplier.html)
if [ "$STYLE_DISPLAY" -le 3 ]; then
    test_result 0 "style.display usage acceptable ($STYLE_DISPLAY occurrences)"
else
    test_result 2 "style.display usage high ($STYLE_DISPLAY occurrences)"
fi

echo ""
echo "5. Code Quality"
echo "---------------"

# Check for console.log
CONSOLE_LOGS=$(grep -c "console.log" public/dashboard-supplier.html || true)
if [ "$CONSOLE_LOGS" -eq 0 ]; then
    test_result 0 "No console.log statements"
else
    test_result 2 "Found $CONSOLE_LOGS console.log statements"
fi

# Check for TODO/FIXME
TODOS=$(grep -c "TODO\|FIXME" public/dashboard-supplier.html || true)
if [ "$TODOS" -eq 0 ]; then
    test_result 0 "No TODO/FIXME comments"
else
    test_result 2 "Found $TODOS TODO/FIXME comments"
fi

echo ""
echo "6. Documentation"
echo "----------------"

if [ -f "PRE_DEPLOYMENT_CHECKLIST.md" ]; then
    test_result 0 "Pre-deployment checklist exists"
else
    test_result 2 "Pre-deployment checklist missing"
fi

if [ -f "docs/PRODUCTION_MONITORING.md" ]; then
    test_result 0 "Production monitoring guide exists"
else
    test_result 2 "Production monitoring guide missing"
fi

if [ -f ".stylelintrc.json" ]; then
    test_result 0 "Stylelint config exists"
else
    test_result 2 "Stylelint config missing (optional)"
fi

echo ""
echo "=================================================="
echo "Validation Summary"
echo "=================================================="
echo -e "${GREEN}Passed${NC}: $PASS"
echo -e "${YELLOW}Warnings${NC}: $WARN"
echo -e "${RED}Failed${NC}: $FAIL"
echo ""

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}✓ ALL CRITICAL CHECKS PASSED${NC}"
    echo "Ready for deployment!"
    exit 0
else
    echo -e "${RED}✗ SOME CRITICAL CHECKS FAILED${NC}"
    echo "Please fix issues before deployment."
    exit 1
fi
