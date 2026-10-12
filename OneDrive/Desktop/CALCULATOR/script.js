const display = document.getElementById("display");
const buttons = document.querySelectorAll("button");

let firstNumber = null;
let operator = null;
let secondNumber = null;
let calculationHistory = [];

function addToHistory(firstNumber, secondNumber, operator, result){
    const calculation = {
        firstNumber:firstNumber,
        secondNumber:secondNumber,
        operator:operator,
        result:result,
    };
    calculationHistory.push(calculation);
}

function add(a,b) {return a+b;}
function subtract (a,b) {return a-b ; }
function multiply (a,b) {return a*b ;}
function divide (a,b) {
    if (b===0){
        return "cannot divide by zero"
    } return a/b;
}

buttons.forEach(function (button) {
  button.addEventListener("click", function () {

        if(button.textContent === "C") {
            display.value = "0";
            firstNumber = null;
            secondNumber = null;
            operator = null;
        }
    else if (button.textContent === "+"||
        button.textContent === "-"||
        button.textContent === "*"||
        button.textContent === "/" 
    ) {
      firstNumber = Number(display.value);
      operator = button.textContent;
      display.value = "0";

    } else if (button.textContent === "=") {
      secondNumber = Number(display.value);

      let result;
      if (operator === "+") {
        result = add(firstNumber, secondNumber);
      } else if (operator === "-") {
        result = subtract(firstNumber,secondNumber);
      } else if (operator === "*") {
        result = multiply(firstNumber, secondNumber);
      } else if (operator === "/"){
        result = divide(firstNumber, secondNumber);
      }
      
      console.log(firstNumber, operator, secondNumber, "=", result);
      display.value = result;
    } else if (display.value === "0") {
        display.value = button.textContent

     } else {
      display.value = display.value + button.textContent;
    }
  });
});
